export default async function run(agent, arg) {
  // Ensure input is treated as a string before reversing
  const str = String(arg); 
  const reversed = str.split("").reverse().join("");
  // Store the result in memory for later retrieval/confirmation
  agent.memory.set("last_reversed_value", reversed);
  return reversed;
}