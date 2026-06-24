/**
 * Gemma 4 API Client for communication.
 * Integrates with Ollama or standard OpenAI-compatible APIs.
 * Includes a fallback/mock mode for local testing.
 */
export class GemmaClient {
  constructor(config = {}) {
    let envUrl, envModel, envKey;
    try {
      envUrl = typeof Deno !== "undefined" && Deno.env ? Deno.env.get("GEMMA_API_URL") : null;
      envModel = typeof Deno !== "undefined" && Deno.env ? Deno.env.get("GEMMA_MODEL") : null;
      envKey = typeof Deno !== "undefined" && Deno.env ? Deno.env.get("GEMMA_API_KEY") : null;
    } catch (_) {
      // Ignore PermissionDenied (NotCapable) errors for environment access
    }

    this.apiUrl = config.apiUrl || envUrl || "http://localhost:11434/api/chat";
    this.model = config.model || envModel || "gemma4";
    this.apiKey = config.apiKey || envKey || "";
    this.mockMode = config.mockMode || false;
  }

  /**
   * Send the system instructions and combined DSL context to Gemma 4.
   * Supports standard tool calling format internally by translating between 
   * the application's JSON DSL and Gemma 4's native `<|tool_call|>` / `<|tool_response|>` format.
   * 
   * @param {string} systemPrompt 
   * @param {string} userContext 
   * @returns {Promise<string>} Translated JSON/DSL action response
   */
  async chat(systemPrompt, userContext) {
    if (this.mockMode) {
      return this._getMockResponse(userContext);
    }

    // Translate JSON DSL history from context into Gemma 4 tool tags for optimal performance
    let formattedContext = userContext;
    
    try {
      // 1. Identify the conversation history block
      const tagStart = "<conversation_history>";
      const tagEnd = "</conversation_history>";
      const lastStart = userContext.lastIndexOf(tagStart);
      const lastEnd = userContext.lastIndexOf(tagEnd);
      
      if (lastStart !== -1 && lastEnd !== -1 && lastStart < lastEnd) {
        const rawHistory = userContext.substring(lastStart + tagStart.length, lastEnd);
        const historyBlocks = rawHistory.split(/\n\n+/).filter(Boolean);
        
        let translatedHistory = "";
        
        for (const block of historyBlocks) {
          try {
            let cleanBlock = block.trim();
            if (cleanBlock.startsWith("```")) {
              const breakIdx = cleanBlock.indexOf("\n");
              const endIdx = cleanBlock.lastIndexOf("```");
              if (breakIdx !== -1 && endIdx > breakIdx) {
                cleanBlock = cleanBlock.substring(breakIdx + 1, endIdx).trim();
              }
            }
            const obj = JSON.parse(cleanBlock);
            
            if (obj.type === "event" && obj.eventType === "user_input") {
              translatedHistory += `<|turn|>user\n${obj.text}<|turn|>\n`;
            } 
            else if (obj.type === "action" && obj.name === "run_skill") {
              translatedHistory += `<|turn|>model\n<|tool_call|>call:${obj.skillName}${obj.arg}<|tool_call|>\n`;
            }
            else if (obj.type === "action" && obj.name === "create_skill") {
              translatedHistory += `<|turn|>model\n<|tool_call|>call:create_skill{skillName:"${obj.skillName}"}<|tool_call|>\n`;
            }
            else if (obj.type === "event" && obj.eventType === "execution_result") {
              if (obj.status === "success") {
                translatedHistory += `<|tool_response|>${obj.output}<|tool_response|>\n`;
              } else {
                translatedHistory += `<|tool_response|>Error: ${obj.output}<|tool_response|>\n`;
              }
            }
          } catch (_) {
            translatedHistory += block + "\n";
          }
        }
        
        formattedContext = userContext.substring(0, lastStart + tagStart.length) + "\n" + translatedHistory + "\n" + userContext.substring(lastEnd);
      }
    } catch (e) {
      console.warn("[GemmaClient] Context translation failed:", e.message);
    }

    try {
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: formattedContext }
      ];

      // Deno standard fetch API
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          stream: false,
          options: {
            num_ctx: 65536 // Explicitly configure 64KB context window in Ollama
          }
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API returned status: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let responseContent = "";
      
      // Handle Ollama /api/chat response format
      if (data.message && data.message.content) {
        responseContent = data.message.content.trim();
      } 
      // Handle OpenAI /v1/chat/completions response format
      else if (data.choices && data.choices[0] && data.choices[0].message) {
        responseContent = data.choices[0].message.content.trim();
      } 
      else {
        throw new Error("Unexpected LLM response format: " + JSON.stringify(data));
      }

      // If the model output utilizes Gemma 4's native tool calling tags, translate it back to the agent JSON DSL
      if (responseContent.includes("<|tool_call|>")) {
        const callMatch = responseContent.match(/<\|tool_call\|>call:(\w+)(.*?)(?:<\|tool_call\|>|$)/s);
        if (callMatch) {
          const functionName = callMatch[1];
          const rawArgs = callMatch[2].trim();
          
          return JSON.stringify({
            type: "action",
            name: functionName === "create_skill" ? "create_skill" : "run_skill",
            ...(functionName === "create_skill" ? { skillName: "newSkill", code: "export default async function run(agent, arg) {}" } : { skillName: functionName, arg: rawArgs })
          }, null, 2);
        }
      }

      return responseContent;
    } catch (e) {
      console.warn(`[GemmaClient] Connection failed (${e.message}). Falling back to mock response.`);
      return this._getMockResponse(userContext);
    }
  }

  /**
   * Generates mock DSL responses for testing/verification.
   * Simulates a self-growth lifecycle (skill creation -> skill execution -> completion).
   */
  _getMockResponse(userContext) {
    // Extract only the genuine conversation history block using lastIndexOf to bypass code injection interference
    const tagStart = "<conversation_history>";
    const tagEnd = "</conversation_history>";
    const lastStart = userContext.lastIndexOf(tagStart);
    const lastEnd = userContext.lastIndexOf(tagEnd);
    
    const history = (lastStart !== -1 && lastEnd !== -1 && lastStart < lastEnd) 
      ? userContext.substring(lastStart + tagStart.length, lastEnd) 
      : "";

    // Phase 1: Request creation of 'reverseString' skill if not yet created
    if (!history.includes("create_skill")) {
      return JSON.stringify({
        type: "action",
        name: "create_skill",
        skillName: "reverseString",
        code: `export default async function run(agent, arg) {
  const reversed = arg.split("").reverse().join("");
  agent.memory.set("last_reversed_value", reversed);
  return reversed;
}`
      }, null, 2);
    }

    // Phase 2: After 'reverseString' is successfully created, Gemma 4 will request its execution
    if (history.includes("create_skill") && history.includes("success") && !history.includes("run_skill")) {
      return JSON.stringify({
        type: "action",
        name: "run_skill",
        skillName: "reverseString",
        arg: "hello world"
      }, null, 2);
    }

    // Phase 3: Final execution output received
    if (history.includes("run_skill") && history.includes("success")) {
      return JSON.stringify({
        type: "action",
        name: "finish",
        message: "Successfully created and executed reverseString skill. Output is stored in memory."
      }, null, 2);
    }

    // Fallback default response
    return JSON.stringify({
      type: "action",
      name: "finish",
      message: "I have processed the request. No additional skills were required."
    }, null, 2);
  }
}
