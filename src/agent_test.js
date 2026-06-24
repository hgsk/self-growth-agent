import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseDSL, stringifyDSL } from "./dsl.js";
import { Memory } from "./memory.js";
import { SkillManager } from "./skill_manager.js";
import { Agent } from "./agent.js";

Deno.test("DSL Parsing and Stringification", () => {
  const dslInput = `{
    type: "action",
    name: "create_skill",
    skillName: "hello",
    code: "export default function() { return \\"hello\\"; }"
  }`;

  const parsed = parseDSL(dslInput);
  assertExists(parsed);
  assertEquals(parsed.type, "action");
  assertEquals(parsed.name, "create_skill");
  assertEquals(parsed.skillName, "hello");
  assertEquals(parsed.code, `export default function() { return "hello"; }`);

  const stringified = stringifyDSL(parsed);
  assertExists(stringified);
  assertEquals(stringified.includes('"name": "create_skill"'), true);
  assertEquals(stringified.includes('"skillName": "hello"'), true);
  assertEquals(stringified.includes('"code": "export default function() { return \\"hello\\"; }"'), true);

  // Test parsing markdown wrapped js code block
  const markdownDslInput = "\`\`\`javascript\n" + dslInput + "\n\`\`\`";
  const parsedMarkdown = parseDSL(markdownDslInput);
  assertExists(parsedMarkdown);
  assertEquals(parsedMarkdown.name, "create_skill");
});

Deno.test("Memory Stack and Dictionary Store", () => {
  const memory = new Memory();
  memory.set("user", "alice");
  assertEquals(memory.get("user"), "alice");

  memory.pushHistory(JSON.stringify({ type: "event", eventType: "user_input", text: "hello" }));
  assertEquals(memory.getHistory().length, 1);
  
  const ctx = memory.getPromptContext();
  assertEquals(ctx.includes('"user": "alice"'), true);
  assertEquals(ctx.includes('<conversation_history>'), true);
  assertEquals(ctx.includes('hello'), true);
});

Deno.test({
  name: "Agent E2E Growth with Mock LLM",
  fn: async () => {
    const originalCwd = Deno.cwd();
    const tempSkillsDir = "./temp_skills";
    const agent = new Agent({
      skillsDir: tempSkillsDir,
      llm: { mockMode: true }
    });

    await agent.init();

    // Trigger input (will run mock loop: create_skill -> run_skill -> finish)
    const finalAnswer = await agent.handleInput("文字列 'hello world' を反転させる新しいスキル reverseString を作成して実行してください。");
    
    // Assert results are successfully computed and output stored in memory
    assertExists(finalAnswer);
    assertEquals(agent.memory.get("last_reversed_value"), "dlrow olleh");

    // Cleanup temp skills directory and MEMORY.md, and restore CWD
    try {
      Deno.chdir(originalCwd);
    } catch (_) {}

    try {
      await Deno.remove(tempSkillsDir, { recursive: true });
    } catch (_) {}
    try {
      await Deno.remove("MEMORY.md");
    } catch (_) {}
    try {
      const { join } = await import("https://deno.land/std@0.224.0/path/mod.ts");
      await Deno.remove(join(originalCwd, "sessions"), { recursive: true });
    } catch (_) {}
  }
});
