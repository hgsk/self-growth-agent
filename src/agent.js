import { parseDSL, stringifyDSL } from "./dsl.js";
import { Memory } from "./memory.js";
import { SkillManager } from "./skill_manager.js";
import { GemmaClient } from "./llm.js";
import { join, isAbsolute } from "https://deno.land/std@0.224.0/path/mod.ts";
import { systemPrompt } from "./system_prompt.js";
import { executeAction } from "./action_executor.js";

/**
 * Main Agent orchestrator implementing the DSL-based loop,
 * runtime memory stack, and self-introspection.
 */
export class Agent {
  constructor(config = {}) {
    this.rootDir = Deno.cwd();
    
    // Create unique session name and path in sessions/ folder
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.sessionName = `session_${timestamp}`;
    this.sessionDir = join(this.rootDir, "sessions", this.sessionName);
    
    this.memory = new Memory();
    
    // Resolve absolute path for skillsDir relative to the rootDir
    const rawSkillsDir = config.skillsDir || "./skills";
    const absoluteSkillsDir = isAbsolute(rawSkillsDir) ? rawSkillsDir : join(this.rootDir, rawSkillsDir);
    this.skillManager = new SkillManager(this, absoluteSkillsDir);
    
    this.llmClient = new GemmaClient(config.llm);
    this.maxLoopIterations = config.maxLoopIterations || 100;
  }

  /**
   * Initializes the agent, creates the session folder, changes the CWD to it, and loads skills.
   */
  async init() {
    // Create session directory and change process CWD to it
    await Deno.mkdir(this.sessionDir, { recursive: true });
    Deno.chdir(this.sessionDir);
    console.log(`[Runtime] Working directory changed to session folder: ${this.sessionDir}`);

    await this.skillManager.init();
  }

  /**
   * Reads the agent's own core modules code to inject into the LLM context.
   * This facilitates self-introspection and self-growth.
   * 
   * @private
   */
  async _getSelfSourceCode() {
    const files = ["agent.js", "dsl.js", "memory.js", "skill_manager.js", "llm.js", "system_prompt.js", "action_executor.js"];
    let source = "<agent_core_code>\n";
    for (const file of files) {
      try {
        const filePath = join(this.rootDir, "src", file);
        const content = await Deno.readTextFile(filePath);
        source += `<!-- FILE: ${file} -->\n${content}\n\n`;
      } catch (_) {
        // Ignore if file doesn't exist (e.g. during specific unit tests)
      }
    }
    source += "</agent_core_code>";
    return source;
  }

  /**
   * Handles user instruction, executing the self-growth loop until completion.
   * 
   * @param {string} userInput 
   * @returns {Promise<string>} Final response from the agent
   */
  async handleInput(userInput) {
    // 1. Pack user input as DSL event and stack into history
    const inputEvent = {
      type: "event",
      eventType: "user_input",
      text: userInput
    };
    this.memory.pushHistory(stringifyDSL(inputEvent));

    let iterations = 0;
    while (iterations < this.maxLoopIterations) {
      iterations++;

      // 2. Build full context including agent's own code, skills, and memory
      const selfSource = await this._getSelfSourceCode();
      const skillsSource = this.skillManager.getSkillsSourceCode();
      const memoryContext = this.memory.getPromptContext();

      const combinedContext = `${selfSource}\n\n${skillsSource}\n\n${memoryContext}`;

      console.log(`\n--- Loop Iteration ${iterations} ---`);
      console.log("[Runtime] Sending DSL prompt to Gemma 4...");
      console.log(`[LLM Input Context]:\n=== SYSTEM PROMPT ===\n${systemPrompt}\n=== COMBINED CONTEXT ===\n${combinedContext}\n======================`);
      
      const response = await this.llmClient.chat(systemPrompt, combinedContext);
      console.log(`[LLM Response]:\n${response}`);

      // Push raw LLM response into history stack
      this.memory.pushHistory(response);

      // 3. Parse action
      const action = parseDSL(response);
      if (!action || action.type !== "action") {
        console.warn("[Runtime] Invalid DSL structure received from LLM. Feeding error back.");
        const errorEvent = {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: "Invalid DSL structure. You must respond with exactly one JavaScript object representing an action."
        };
        this.memory.pushHistory(stringifyDSL(errorEvent));
        continue;
      }

      // 4. Execute Action
      const result = await executeAction(this, action);
      if (result) {
        if (result.type === "finish") {
          return result.message;
        }
        if (result.type === "continue" && result.event) {
          this.memory.pushHistory(stringifyDSL(result.event));
        }
      } else {
        console.warn(`[Runtime] Unknown action received: ${action.name}`);
        const errorEvent = {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: `Unknown action: ${action.name}`
        };
        this.memory.pushHistory(stringifyDSL(errorEvent));
      }
    }

    throw new Error(`Core loop exceeded maximum limit of ${this.maxLoopIterations} iterations.`);
  }
}

// Runnable CLI CLI interface when executed directly
if (import.meta.main) {
  const agent = new Agent();
  await agent.init();

  const userInput = Deno.args.join(" ") || "文字列 'hello world' を反転させる新しいスキル reverseString を作成して実行してください。";
  console.log(`[User Request]: ${userInput}`);
  
  try {
    const finalResponse = await agent.handleInput(userInput);
    console.log(`\n[Agent Final Answer]:\n${finalResponse}`);
    console.log(`\n[Memory Store state]:\n`, JSON.stringify(agent.memory.getStore(), null, 2));
  } catch (error) {
    console.error("Agent execution failed:", error);
  }
}
