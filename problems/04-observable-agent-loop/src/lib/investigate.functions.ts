import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runAgentLoop } from "./agent/runner";
import { createDefaultRegistry } from "./tools/registry";
import { NemotronAdapter } from "./models/nemotron-adapter";

// Re-export all types the frontend needs — prevents the UI from importing
// deep into the agent internals.
export type { InvestigationRun, TraceStep, EvidenceItem } from "./agent/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Hard upper limit on the number of tool-call steps per investigation.
 * The runner enforces this: once reached it stops WITHOUT another model call.
 * Configurable here without touching the runner or frontend.
 */
const MAX_STEPS = 6;

/**
 * Nemotron model ID. Override via NEMOTRON_MODEL_ID env var.
 * Nemotron is the hardcoded production model for this assignment.
 * If you need a different variant, set NEMOTRON_MODEL_ID in your .env file.
 */
const NEMOTRON_MODEL_ID =
  process.env["NEMOTRON_MODEL_ID"] ?? "nvidia/llama-3.1-nemotron-70b-instruct";

// ---------------------------------------------------------------------------
// TOOL_MANIFEST — consumed by the frontend to render the available-tools panel.
// Kept as a simple static array; not derived from the registry at runtime so
// the frontend can import it without triggering server-side tool loading.
// ---------------------------------------------------------------------------
export const TOOL_MANIFEST = [
  {
    name: "search_logs",
    args: "service, query, limit",
    description: "Search recent application log lines for a service.",
  },
  {
    name: "get_metrics",
    args: "service, metric, window",
    description: "Read error_rate, latency_p99, throughput, or saturation.",
  },
  {
    name: "get_service_status",
    args: "service",
    description: "Health, recent deploy history, and dependency status.",
  },
] as const;

// ---------------------------------------------------------------------------
// Server function — the only entry point from the browser.
// Thin wrapper: reads env, builds adapter + registry, delegates to runner.
// ---------------------------------------------------------------------------

const InputSchema = z.object({ objective: z.string().min(4) });

export const runInvestigation = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["NVIDIA_API_KEY"];

    if (!apiKey) {
      // Return a well-formed InvestigationRun so the frontend renders correctly.
      return {
        objective: data.objective,
        model: NEMOTRON_MODEL_ID,
        maxSteps: MAX_STEPS,
        stepsUsed: 0,
        status: "failed" as const,
        terminationReason: "NVIDIA_API_KEY is not set. Add it to your .env file.",
        steps: [],
        evidence: [],
        conclusion: null,
        error:
          "NVIDIA_API_KEY environment variable is missing. " +
          "Set it in your .env file: NVIDIA_API_KEY=nvapi-...",
      };
    }

    const adapter = new NemotronAdapter(apiKey, NEMOTRON_MODEL_ID);
    const registry = createDefaultRegistry();

    return runAgentLoop(data.objective, adapter, registry, MAX_STEPS);
  });
