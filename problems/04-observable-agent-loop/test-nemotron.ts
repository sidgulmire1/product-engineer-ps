import { NemotronAdapter } from "./src/lib/models/nemotron-adapter.ts";
import { runAgentLoop } from "./src/lib/agent/runner.ts";
import { createDefaultRegistry } from "./src/lib/tools/registry.ts";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) throw new Error("NVIDIA_API_KEY not found in .env");

const modelId = process.env.NEMOTRON_MODEL_ID;
if (!modelId) throw new Error("NEMOTRON_MODEL_ID not found in .env");

console.log("=== STARTING NEMOTRON TESTS ===");
console.log(`Model: ${modelId}\n`);

const registry = createDefaultRegistry();
const adapter = new NemotronAdapter(apiKey, modelId);

async function runTests() {
  console.log("--- TEST 1: Minimal Tool Call ---");
  const t1 = await runAgentLoop(
    "Check the current status of payment-service.",
    adapter,
    registry,
    3
  );
  console.log("Status:", t1.status);
  console.log("Steps Used:", t1.stepsUsed);
  if (t1.steps.length > 0) {
    console.log("Raw Tool Call 1:");
    console.log(JSON.stringify(t1.steps[0], null, 2));
  }
  
  if (t1.status !== 'success') {
    console.log("\nTest 1 did not succeed properly. Stopping.");
    console.log("Final Error:", t1.error);
    return;
  }

  console.log("\n--- TEST 2: Genuine Multi-Step ---");
  const t2 = await runAgentLoop(
    "Investigate the payment-service incident. Check the recent logs and then check the service metrics/status before providing your conclusion.",
    adapter,
    registry,
    6
  );
  console.log("Status:", t2.status);
  console.log("Steps Used:", t2.stepsUsed);
  console.log("Evidence collected:", t2.evidence.length);
  for (const step of t2.steps) {
     if (step.phase === 'tool') {
        console.log(`- ${step.decisionSummary} (Validated: ${step.validated})`);
     }
  }
  console.log("\nConclusion:", t2.conclusion);
}

runTests().catch(e => console.error(e));
