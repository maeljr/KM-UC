// Service that calls the backend knowledge assistant.
// Returns a promise resolving to the assistant's text response.

const cannedReplies = [
  "Based on CSSF 20/750, financial entities must maintain a documented ICT and security risk management framework, reviewed at least annually by the management body.",
  "Per EBA/GL/2019/02, institutions must keep a register of all outsourcing arrangements and apply enhanced due diligence to critical or important functions.",
  "Under CRD VI (Art. 74), governance arrangements require a clear organisational structure with well-defined, transparent, and consistent lines of responsibility.",
  "An audit should verify documentation, governance ownership, and the outsourcing register jointly, as these obligations are cumulative.",
];

export async function sendMessage(prompt: string): Promise<string> {
  // Simulated backend latency.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // Simulated transient failure for empty prompts.
  if (!prompt.trim()) {
    throw new Error("Empty prompt");
  }

  const reply = cannedReplies[Math.floor(Math.random() * cannedReplies.length)];
  return `${reply}\n\n(Regarding: "${prompt.trim()}")`;
}
