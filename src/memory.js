/**
 * Memory class managing JS object-based dictionary and DSL conversation history.
 */
export class Memory {
  constructor() {
    this.store = {}; // JS Object-based key-value dictionary
    this.history = []; // Array of raw DSL strings representing the event/action log
  }

  /**
   * Set a key-value pair in the memory dictionary.
   * @param {string} key 
   * @param {any} value 
   */
  set(key, value) {
    this.store[key] = value;
  }

  /**
   * Get a value from the memory dictionary.
   * @param {string} key 
   * @returns {any}
   */
  get(key) {
    return this.store[key];
  }

  /**
   * Push a raw DSL message string into the history stack.
   * @param {string} dslString 
   */
  pushHistory(dslString) {
    if (typeof dslString !== "string") {
      throw new Error("History must be pushed as a raw DSL string");
    }
    this.history.push(dslString.trim());
  }

  /**
   * Returns all DSL history records.
   * @returns {string[]}
   */
  getHistory() {
    return this.history;
  }

  /**
   * Returns the entire key-value store object.
   * @returns {object}
   */
  getStore() {
    return this.store;
  }

  /**
   * Build the prompt context within a character limit (tuning for 64KB context size).
   * Default maxChars is ~50,000 characters (leaving space for system prompts and outputs).
   * 
   * @param {number} maxChars 
   * @returns {string} Combined DSL context string
   */
  getPromptContext(maxChars = 50000) {
    const memoryStr = `<memory_store>\n${JSON.stringify(this.store, null, 2)}\n</memory_store>`;
    
    let currentLength = memoryStr.length + 100; // Offset for structural tags
    const relevantHistory = [];
    
    // Process history backwards to keep the most recent messages
    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];
      if (currentLength + msg.length + 2 > maxChars) {
        break; // Stop including older history if limit reached
      }
      relevantHistory.unshift(msg);
      currentLength += msg.length + 2;
    }

    const historyStr = relevantHistory.join("\n\n");
    return `${memoryStr}\n\n<conversation_history>\n${historyStr}\n</conversation_history>`;
  }
}
