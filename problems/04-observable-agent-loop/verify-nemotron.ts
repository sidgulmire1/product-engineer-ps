import { runAgentLoop } from "./src/lib/agent/runner.ts";
import { ToolRegistry } from "./src/lib/tools/registry.ts";
import { searchLogsTool } from "./src/lib/tools/search-logs.ts";
import { getMetricsTool } from "./src/lib/tools/get-metrics.ts";
import { getServiceStatusTool } from "./src/lib/tools/get-service-status.ts";
import { NemotronAdapter } from "./src/lib/models/nemotron-adapter.ts";

function makeRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(searchLogsTool);
  r.register(getMetricsTool);
  r.register(getServiceStatusTool);
  return r;
}

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY;
  const modelId = process.env.NEMOTRON_MODEL_ID || "nvidia/nemotron-3-ultra-550b-a55b";
  
  if (!apiKey) throw new Error("Missing NVIDIA_API_KEY");

  const adapter = new NemotronAdapter(apiKey, modelId);
  const registry = makeRegistry();

  console.log("=== STARTING NEMOTRON TESTS ===");
  console.log(`Model: ${modelId}`);

  console.log("\n--- TEST 1: Minimal Tool Call ---");
  const result1 = await runAgentLoop(
    "Check the current status of payment-service.",
    adapter,
    registry,
    3
  );

  console.log("\nStatus:", result1.status);
  console.log("Steps Used:", result1.steps?.length ? result1.steps.length - 2 : result1.stepsUsed); 
  const call1 = result1.steps?.find(t => t.phase === "tool");
  if (call1) {
    console.log("Raw Tool Call 1:");
    console.log(JSON.stringify(call1, null, 2));
  }

  console.log("\n--- TEST 2: Genuine Multi-Step ---");
  const result2 = await runAgentLoop(
    "Investigate the payment-service incident. Check the recent logs and then check the service metrics or service status before providing your conclusion.",
    adapter,
    registry,
    5
  );

  console.log("\nStatus:", result2.status);
  console.log("Steps Used:", result2.steps?.length ? result2.steps.length - 2 : result2.stepsUsed);
  const calls = result2.steps?.filter(t => t.phase === "tool") || [];
  calls.forEach((c, i) => {
    console.log(`Tool Call ${i + 1}: ${c.tool}(${JSON.stringify(c.input)})`);
    console.log(`Error: ${c.error || 'None'}`);
  });
  const conclusion = result2.steps?.find(t => t.phase === "conclusion");
  console.log("Conclusion:", conclusion ? JSON.stringify(conclusion.output, null, 2) : 'None');
}

main().catch(console.error);
