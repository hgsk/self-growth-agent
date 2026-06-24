/**
 * Parses a DSL JavaScript-like string into a structured JavaScript object.
 * Supports Pure JavaScript object / JSON.
 * 
 * @param {string} dslStr 
 * @returns {object|null} parsed object or null
 */
export function parseDSL(dslStr) {
  if (!dslStr) return null;

  let cleanStr = dslStr.trim();
  // Strip markdown code block fences if present
  if (cleanStr.startsWith("```")) {
    const firstLineBreak = cleanStr.indexOf("\n");
    const lastFence = cleanStr.lastIndexOf("```");
    if (firstLineBreak !== -1 && lastFence > firstLineBreak) {
      cleanStr = cleanStr.substring(firstLineBreak + 1, lastFence).trim();
    } else {
      // Fallback: strip beginning and end fences
      cleanStr = cleanStr.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/\n?```$/, "").trim();
    }
  }

  try {
    // Evaluate the JavaScript string as an object literal
    const obj = new Function(`return (${cleanStr})`)();
    if (obj && typeof obj === "object") {
      return obj;
    }
  } catch (e1) {
    try {
      const obj = JSON.parse(cleanStr);
      if (obj && typeof obj === "object") {
        return obj;
      }
    } catch (e2) {
      console.warn("[parseDSL] Both eval and JSON.parse failed.");
      console.warn("Eval error:", e1.message);
      console.warn("JSON error:", e2.message);
      console.warn("Failed string content:\n", cleanStr);
    }
  }

  return null;
}

/**
 * Converts a structured DSL object back into a JavaScript object literal string.
 * 
 * @param {object} obj 
 * @returns {string} Pure JavaScript object string
 */
export function stringifyDSL(obj) {
  if (!obj) throw new Error("Object to stringify cannot be null or undefined");

  if (obj.type !== "action" && obj.type !== "event") {
    throw new Error(`Invalid DSL object type: ${obj.type}`);
  }

  return JSON.stringify(obj, null, 2);
}
