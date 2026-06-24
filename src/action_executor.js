import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { stringifyDSL } from "./dsl.js";

/**
 * Executes a DSL action against the current Agent instance context.
 * Returns { type: "finish", message: string } or { type: "continue", event: object }
 * 
 * @param {Agent} agent 
 * @param {object} action 
 * @returns {Promise<object|null>}
 */
export async function executeAction(agent, action) {
  if (action.name === "finish") {
    // Enforce subtask completion guardrail
    const subtasks = agent.memory.get("subtasks");
    if (subtasks && Array.isArray(subtasks)) {
      const uncompleted = subtasks.filter(t => t.status !== "completed");
      if (uncompleted.length > 0) {
        console.warn(`[Runtime] Rejecting finish: ${uncompleted.length} subtasks are still uncompleted.`);
        return {
          type: "continue",
          event: {
            type: "event",
            eventType: "execution_result",
            status: "error",
            output: `Cannot finish processing yet. There are still ${uncompleted.length} uncompleted subtasks: ${uncompleted.map(t => `'${t.description}'`).join(", ")}. You must execute these tasks and call split_tasks to update their status to 'completed' before calling finish.`
          }
        };
      }
    }

    console.log("[Runtime] Agent finish. Message:", action.message);
    try {
      const store = agent.memory.getStore();
      const content = `# Memory Dump\n\n\`\`\`json\n${JSON.stringify(store, null, 2)}\n\`\`\`\n`;
      await Deno.writeTextFile("MEMORY.md", content);
      console.log("[Runtime] Memory store successfully dumped to MEMORY.md");
    } catch (e) {
      console.warn("[Runtime] Failed to dump memory to MEMORY.md:", e.message);
    }

    // Git add and commit the session folder changes
    try {
      console.log("[Runtime] Committing session changes to Git...");
      const addCmd = new Deno.Command("git", {
        args: ["add", "."],
      });
      await addCmd.output();

      const commitCmd = new Deno.Command("git", {
        args: ["commit", "-m", `Auto-commit completed session: ${agent.sessionName}`],
      });
      const { success, stderr } = await commitCmd.output();
      if (success) {
        console.log("[Runtime] Git commit completed successfully.");
      } else {
        const errText = new TextDecoder().decode(stderr).trim();
        console.log("[Runtime] Git commit skipped or did not complete:", errText);
      }
    } catch (gitErr) {
      console.warn("[Runtime] Git commands failed:", gitErr.message);
    }

    return { type: "finish", message: action.message };
  }

  if (action.name === "create_skill") {
    try {
      // Save the skill first
      await agent.skillManager.saveSkill(action.skillName, action.code);
      
      let output = `Skill '${action.skillName}' created and loaded successfully.`;

      // If testCode is provided, write it and run the Deno test runner
      if (action.testCode) {
        const testFilePath = join(Deno.cwd(), agent.skillManager.skillsDir, `${action.skillName}_test.js`);
        await Deno.writeTextFile(testFilePath, action.testCode);
        console.log(`[Runtime] Running tests for skill '${action.skillName}'...`);
        
        const command = new Deno.Command(Deno.execPath(), {
          args: ["test", "--allow-read", "--allow-write", "--allow-net", "--allow-env", testFilePath],
        });
        const { success, code, stdout, stderr } = await command.output();
        const decoder = new TextDecoder();
        const outputText = decoder.decode(stdout) + "\n" + decoder.decode(stderr);
        
        if (!success) {
          // Delete the invalid skill and test file so they don't corrupt the workspace
          try { await Deno.remove(testFilePath); } catch (_) {}
          throw new Error(`Tests failed (exit code ${code}):\n${outputText}`);
        }
        console.log(`[Runtime] Tests passed successfully:\n${outputText}`);
        output += ` Tests passed successfully.`;
      }
      
      if (action.arg !== undefined) {
        console.log(`[Runtime] Automatically running newly created skill '${action.skillName}'...`);
        const result = await agent.skillManager.runSkill(action.skillName, action.arg);
        output = typeof result === "string" ? result : JSON.stringify(result);
      }

      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "success",
          output: output
        }
      };
    } catch (e) {
      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: `Failed to create skill '${action.skillName}': ${e.message}`
        }
      };
    }
  }

  if (action.name === "run_skill") {
    try {
      const result = await agent.skillManager.runSkill(action.skillName, action.arg);
      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "success",
          output: typeof result === "string" ? result : JSON.stringify(result)
        }
      };
    } catch (e) {
      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: `Skill '${action.skillName}' execution failed: ${e.message}`
        }
      };
    }
  }

  if (action.name === "ask_user") {
    try {
      console.log(`\n[Agent Question]: ${action.question}`);
      const options = action.options || [];
      options.forEach((opt, idx) => {
        console.log(`  ${idx + 1}. ${opt}`);
      });

      let choiceIndex = -1;
      while (choiceIndex < 0 || choiceIndex >= options.length) {
        const answer = prompt(`Select option (1-${options.length}):`);
        if (answer === null) {
          choiceIndex = 0;
          break;
        }
        const parsed = parseInt(answer.trim(), 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= options.length) {
          choiceIndex = parsed - 1;
        } else {
          const matchedIdx = options.findIndex(o => o.toLowerCase() === answer.trim().toLowerCase());
          if (matchedIdx !== -1) {
            choiceIndex = matchedIdx;
          }
        }
      }

      const selectedOption = options[choiceIndex];
      console.log(`[User Selected]: ${selectedOption}`);

      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "user_response",
          selectedOption: selectedOption
        }
      };
    } catch (e) {
      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: `Failed to prompt user: ${e.message}`
        }
      };
    }
  }

  if (action.name === "split_tasks") {
    try {
      agent.memory.set("subtasks", action.subtasks);
      console.log("\n[Subtask Breakdown]:");
      action.subtasks.forEach((t) => {
        console.log(`  - [${t.status === "completed" ? "x" : " "}] ${t.description}`);
      });

      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "success",
          output: "Tasks successfully split and stored in memory."
        }
      };
    } catch (e) {
      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: `Failed to split tasks: ${e.message}`
        }
      };
    }
  }

  if (action.name === "run_tests") {
    try {
      console.log(`[Runtime] Running test command: ${action.command} ${action.args ? action.args.join(" ") : ""}`);
      const testCmd = new Deno.Command(action.command, {
        args: action.args || [],
      });
      const { success, code, stdout, stderr } = await testCmd.output();
      const decoder = new TextDecoder();
      const outputText = decoder.decode(stdout) + "\n" + decoder.decode(stderr);
      
      console.log(`[Runtime] Test completed with status: ${success ? "SUCCESS" : "FAILURE"}`);

      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "test_result",
          status: success ? "success" : "failure",
          code: code,
          output: outputText
        }
      };
    } catch (e) {
      return {
        type: "continue",
        event: {
          type: "event",
          eventType: "execution_result",
          status: "error",
          output: `Failed to execute tests: ${e.message}`
        }
      };
    }
  }

  return null;
}
