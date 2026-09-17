import { runAgentLoop } from "./src/lib/agent/runner.ts";
import { createDefaultRegistry } from "./src/lib/tools/registry.ts";
import { NemotronAdapter } from "./src/lib/models/nemotron-adapter.ts";


const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) throw new Error("NVIDIA_API_KEY not found in .env");

const modelId = process.env.NEMOTRON_MODEL_ID ?? "nvidia/llama-3.1-nemotron-70b-instruct";
const registry = createDefaultRegistry();
const adapter = new NemotronAdapter(apiKey, modelId);

async function verify() {
  console.log("=== STARTING E2E VERIFICATION ===");
  console.log(`Model: ${modelId}`);

  // Test 1 & 2: Multi-step investigation
  console.log("\n--- TEST A: Normal Multi-Step ---");
  const run1 = await runAgentLoop(
    "Investigate the payment-service incident. Check recent logs and then check the service metrics/status to determine whether the service is currently degraded.",
    adapter,
    registry,
    6
  );
  console.log("Status:", run1.status);
  console.log("Steps Used:", run1.stepsUsed);
  console.log("Evidence items:", run1.evidence.length);
  console.log("Tools called:", run1.steps.map(s => s.tool).filter(Boolean).join(", "));
  
  if (run1.status !== "resolved") {
    console.error("Test A FAILED: Not resolved", run1);
  }

  // Test 3: Tool failure & Unknown tool
  console.log("\n--- TEST B: Tool Failures ---");
  const run2 = await runAgentLoop(
    "Check the status for 'nonexistent-service'. Also try to check the status of 'payment-service'.",
    adapter,
    registry,
    6
  );
  console.log("Status:", run2.status);
  const executionErrors = run2.steps.filter(s => s.errorKind === "execution");
  console.log("Execution errors found:", executionErrors.length > 0);
  if (executionErrors.length > 0) {
    console.log("Sample error:", executionErrors[0].error);
  }

  // Test 4: Execution Limit
  console.log("\n--- TEST C: Execution Limit ---");
  const run3 = await runAgentLoop(
    "Thoroughly analyze all logs and metrics for payment-service, checkout-api, and stripe-gateway.",
    adapter,
    registry,
    2 // strict limit to force limit_reached
  );
  console.log("Status:", run3.status);
  console.log("Steps Used:", run3.stepsUsed);
  console.log("Conclusion:", run3.conclusion);
  if (run3.status !== "limit_reached") {
    console.error("Test C FAILED: Should be limit_reached");
  }

  console.log("\n=== E2E VERIFICATION COMPLETE ===");
}

verify().catch(console.error);
