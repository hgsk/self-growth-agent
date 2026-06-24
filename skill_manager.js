import { join, fromFileUrl, dirname, toFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";

/**
 * Manages dynamically loaded agent skills.
 * Handles reading/writing module files and importing them with cache busting.
 */
export class SkillManager {
  constructor(agent, skillsDir = "./skills") {
    this.agent = agent;
    this.skillsDir = skillsDir;
    this.skills = {}; // name -> function mapping
    this.skillsSource = {}; // name -> raw source code mapping (for LLM context)
  }

  /**
   * Initializes the manager by ensuring the skills directory exists and loading existing skills.
   */
  async init() {
    try {
      await Deno.mkdir(this.skillsDir, { recursive: true });
    } catch (_) {
      // Ignore if directory already exists
    }
    await this.loadAllSkills();
  }

  /**
   * Scans the skills directory and loads all javascript files.
   */
  async loadAllSkills() {
    try {
      for await (const entry of Deno.readDir(this.skillsDir)) {
        if (entry.isFile && (entry.name.endsWith(".js") || entry.name.endsWith(".ts"))) {
          const name = entry.name.slice(0, -3); // Strip extension
          await this.loadSkill(name);
        }
      }
    } catch (e) {
      console.warn("[SkillManager] Error reading skills directory:", e.message);
    }
  }

  /**
   * Dynamically imports a skill module using file URL and cache busting.
   * 
   * @param {string} name 
   */
  async loadSkill(name) {
    const absoluteSkillsDir = join(Deno.cwd(), this.skillsDir);
    const filePath = join(absoluteSkillsDir, `${name}.js`);
    
    // Safely generate a file URL using Deno's standard library
    const fileUrl = toFileUrl(filePath).href;
    const cacheBustingUrl = `${fileUrl}?t=${Date.now()}`;

    try {
      const module = await import(cacheBustingUrl);
      if (typeof module.default !== "function") {
        throw new Error(`Module does not export a default function`);
      }
      
      this.skills[name] = module.default;
      
      // Load raw code to provide it as LLM context
      const rawCode = await Deno.readTextFile(filePath);
      this.skillsSource[name] = rawCode;
      
      console.log(`[SkillManager] Loaded skill: ${name}`);
    } catch (e) {
      console.error(`[SkillManager] Failed to load skill '${name}':`, e.message);
      throw e; // Rethrow to let the agent core and tests know about the failure
    }
  }

  /**
   * Saves skill code to disk and dynamically imports/re-imports it.
   * 
   * @param {string} name 
   * @param {string} code 
   */
  async saveSkill(name, code) {
    const absoluteSkillsDir = join(Deno.cwd(), this.skillsDir);
    const filePath = join(absoluteSkillsDir, `${name}.js`);
    
    await Deno.writeTextFile(filePath, code);
    console.log(`[SkillManager] Saved skill file: ${filePath}`);
    
    await this.loadSkill(name);
  }

  /**
   * Executes a loaded skill function.
   * 
   * @param {string} name 
   * @param {string} arg 
   * @returns {Promise<any>} Output from the skill execution
   */
  async runSkill(name, arg) {
    const skillFn = this.skills[name];
    if (!skillFn) {
      throw new Error(`Skill '${name}' is not loaded or does not exist.`);
    }
    
    console.log(`[SkillManager] Executing skill '${name}' with arg:`, arg);
    // Pass agent instance and the raw argument to the skill function
    return await skillFn(this.agent, arg);
  }

  /**
   * Generates a context block containing all registered skills' source code.
   * Enables Gemma 4 to introspect and adapt current skills.
   * 
   * @returns {string} XML-like source codes block
   */
  getSkillsSourceCode() {
    let source = "<existing_skills>\n";
    for (const [name, code] of Object.entries(this.skillsSource)) {
      source += `<skill name="${name}">\n${code}\n</skill>\n`;
    }
    source += "</existing_skills>";
    return source;
  }
}
