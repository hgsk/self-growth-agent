import { parseDSL, stringifyDSL } from "./dsl.js";
import { Memory } from "./memory.js";
import { SkillManager } from "./skill_manager.js";
import { GemmaClient } from "./llm.js";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

/**
 * Main Agent orchestrator implementing the DSL-based loop,
 * runtime memory stack, and self-introspection.
 */
export class Agent {
  constructor(config = {}) {
    this.memory = new Memory();
    this.skillManager = new SkillManager(this, config.skillsDir);
    this.llmClient = new GemmaClient(config.llm);
    this.maxLoopIterations = config.maxLoopIterations || 10;
  }

  /**
   * Initializes the agent and its skill directory.
   */
  async init() {
    await this.skillManager.init();
  }

  /**
   * Reads the agent's own core modules code to inject into the LLM context.
   * This facilitates self-introspection and self-growth.
   * 
   * @private
   */
  async _getSelfSourceCode() {
    const files = ["agent.js", "dsl.js", "memory.js", "skill_manager.js", "llm.js"];
    let source = "<agent_core_code>\n";
    for (const file of files) {
      try {
        const filePath = join(Deno.cwd(), file);
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

    const systemPrompt = `You are a self-growth agent running on Deno JavaScript.
You must communicate with the runtime ONLY using the defined DSL Pure JavaScript object representation.
Do not include any conversational explanations, thoughts, or formatting outside the JavaScript object literal.
Your output must consist of exactly one valid JavaScript object (representing an action).

CRITICAL: Output a Pure JavaScript object literal, NOT JSON. Use backticks (\`) for multiline code strings (like in the "code" field) so you do not have to escape double quotes or newlines. Do not wrap keys in quotes.

Available DSL Actions:
1. Create a new skill or update an existing skill (writes ES Module to disk):
{
  type: "action",
  name: "create_skill",
  skillName: "skillName",
  code: \`export default async function run(agent, arg) {
    // ES Module format
    // Must export default async function run(agent, arg)
    // You can read/write data in memory: agent.memory.set("key", value)
    return "result";
  }\`
}

2. Run a previously created skill:
{
  type: "action",
  name: "run_skill",
  skillName: "skillName",
  arg: "arguments for the skill"
}

3. Finish processing and return the final message to the user:
{
  type: "action",
  name: "finish",
  message: "Final response to user"
}

Rules:
- Introspect your own core code and existing skills provided in the context to determine the best approach.
- If you need a new capability to solve the user's request, create a skill for it first.
- Once a skill is created, you must trigger run_skill to execute it and see the result.
- After obtaining the execution results (which will be feed back to you as execution_result events), evaluate if the goal is met and then finish.
- NEVER talk or write natural language responses outside of the JavaScript object literal. Always strictly output the Pure JavaScript object representation.`;

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
      if (action.name === "finish") {
        console.log("[Runtime] Agent finish. Message:", action.message);
        return action.message;
      }

      if (action.name === "create_skill") {
        try {
          await this.skillManager.saveSkill(action.skillName, action.code);
          const resultEvent = {
            type: "event",
            eventType: "execution_result",
            status: "success",
            output: `Skill '${action.skillName}' created and loaded successfully.`
          };
          this.memory.pushHistory(stringifyDSL(resultEvent));
        } catch (e) {
          const errorEvent = {
            type: "event",
            eventType: "execution_result",
            status: "error",
            output: `Failed to create skill '${action.skillName}': ${e.message}`
          };
          this.memory.pushHistory(stringifyDSL(errorEvent));
        }
      } 
      else if (action.name === "run_skill") {
        try {
          const result = await this.skillManager.runSkill(action.skillName, action.arg);
          const resultEvent = {
            type: "event",
            eventType: "execution_result",
            status: "success",
            output: typeof result === "string" ? result : JSON.stringify(result)
          };
          this.memory.pushHistory(stringifyDSL(resultEvent));
        } catch (e) {
          const errorEvent = {
            type: "event",
            eventType: "execution_result",
            status: "error",
            output: `Skill '${action.skillName}' execution failed: ${e.message}`
          };
          this.memory.pushHistory(stringifyDSL(errorEvent));
        }
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
