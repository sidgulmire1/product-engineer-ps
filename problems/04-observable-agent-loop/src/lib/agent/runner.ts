import { z } from "zod";
import type { ModelAdapter } from "./model-adapter";
import type {
  ConversationMessage,
  EvidenceItem,
  InvestigationRun,
  TraceStep,
} from "./types";
import type { ToolRegistry } from "../tools/registry";
import { ToolExecutionError } from "../tools/types";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * runAgentLoop — the agent orchestrator.
 *
 * Drives a real multi-step control loop:
 *   1. Calls adapter.complete() to get a model decision (tool call or final text).
 *   2. If the model requests a tool:
 *      a. Validates arguments with the tool's Zod schema.
 *      b. Executes the tool (catches ToolExecutionError separately).
 *      c. Records the step and feeds the result back into the conversation.
 *      d. Increments stepsUsed.
 *   3. If the model produces final text: records it, builds the conclusion,
 *      sets status = "resolved", and stops.
 *   4. When stepsUsed reaches maxSteps the loop ends naturally.
 *      Status is set to "limit_reached" and NO additional adapter call is made.
 *      conclusion is left null — the run stopped before a model conclusion was produced.
 *
 * Requirements satisfied:
 *   Req 2  — model selects tools via structured tool calls.
 *   Req 3  — every tool call is validated before execution.
 *   Req 4  — tool results feed back into messages for the next step.
 *   Req 5  — tool failures are recorded and the loop continues.
 *   Req 6  — maxSteps is enforced.
 *   Req 7  — at limit: loop stops without another adapter or tool call.
 *   Req 8  — limit_reached run returns collected evidence + null conclusion.
 *   Req 9  — decisionSummary is derived from tool name/args, never raw reasoning.
 *   Req 10 — trace contains only operational information.
 *   Req 11 — evidence[] is separate from conclusion.
 */
export async function runAgentLoop(
  objective: string,
  adapter: ModelAdapter,
  registry: ToolRegistry,
  maxSteps: number,
): Promise<InvestigationRun> {
  const run: InvestigationRun = {
    objective,
    model: adapter.name,
    maxSteps,
    stepsUsed: 0,
    status: "failed",
    terminationReason: "",
    steps: [],
    evidence: [],
    conclusion: null,
    error: null,
  };

  const systemPrompt = buildSystemPrompt(maxSteps);
  const messages: ConversationMessage[] = [
    { role: "user", content: `Objective: ${objective}` },
  ];
  const tools = registry.list();

  try {
    // -----------------------------------------------------------------------
    // Main loop — exactly maxSteps iterations, one adapter.complete() per step.
    // -----------------------------------------------------------------------
    for (let i = 0; i < maxSteps; i++) {
      const stepStart = Date.now();

      const response = await adapter.complete({ systemPrompt, messages, tools });

      // --- Branch A: model decided to stop and produce its final analysis ---
      if (response.kind === "final_text") {
        const step: TraceStep = {
          index: run.steps.length + 1,
          phase: "decision",
          decisionSummary: response.decisionSummary,
          tool: null,
          input: null,
          output: response.text || null,
          error: null,
          errorKind: null,
          validated: true,
          durationMs: Date.now() - stepStart,
        };
        run.steps.push(step);
        run.status = "resolved";
        run.terminationReason = "Agent produced a complete final response.";
        run.conclusion = parseConclusion(response.text);

        // Feed the final assistant message back (for message-history integrity).
        messages.push({ role: "assistant", content: response.text });
        break;
      }

      // --- Branch B: model requested a tool call ---
      run.stepsUsed += 1;
      const call = response.toolCall;

      const step: TraceStep = {
        index: run.steps.length + 1,
        phase: "tool",
        decisionSummary: response.decisionSummary,
        tool: call.toolName,
        input: null,
        output: null,
        error: null,
        errorKind: null,
        validated: false,
        durationMs: 0,
      };

      let toolResult: unknown;

      const spec = registry.get(call.toolName);

      if (!spec) {
        // Unknown tool — not in registry.
        step.error = `unknown_tool: "${call.toolName}" is not registered. Available tools: ${tools.map((t) => t.name).join(", ")}`;
        step.errorKind = "validation";
        toolResult = { error: step.error };
      } else {
        // Validate arguments with the tool's schema.
        const parsed = spec.schema.safeParse(call.args);
        if (!parsed.success) {
          step.error = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
            .join("; ");
          step.errorKind = "validation";
          step.input = safeStringify(call.args);
          toolResult = { error: `invalid_arguments: ${step.error}` };
        } else {
          // Arguments are valid — attempt execution.
          step.validated = true;
          step.input = JSON.stringify(parsed.data);
          try {
            const output = await spec.execute(parsed.data);
            step.output = JSON.stringify(output ?? null, null, 2);
            toolResult = output;

            // Collect evidence from successful tool executions.
            run.evidence.push({
              finding: summarizeToolOutput(call.toolName, parsed.data, output),
              source: `step ${step.index} · ${call.toolName}`,
            });
          } catch (err) {
            const msg =
              err instanceof ToolExecutionError || err instanceof Error
                ? err.message
                : "tool execution failed";
            step.error = msg;
            step.errorKind = "execution";
            toolResult = { error: msg };
          }
        }
      }

      step.durationMs = Date.now() - stepStart;
      run.steps.push(step);

      // Feed the tool call + its result back into the conversation so the model
      // can use the outcome when deciding the next action.
      messages.push({
        role: "assistant",
        content: response.decisionSummary,
        toolCall: call,
      });
      messages.push({
        role: "tool",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result: toolResult,
      });

      // The loop counter (i) controls how many times we call the adapter.
      // After maxSteps iterations, the for-loop exits and we reach the
      // limit-handling block below — NO extra adapter call is made.
    }

    // -----------------------------------------------------------------------
    // Post-loop: handle limit_reached if not already resolved.
    // -----------------------------------------------------------------------
    if (run.status !== "resolved") {
      // Requirement 7 & 8: stop without another model call.
      // conclusion stays null — the run ended before the model could conclude.
      run.status = "limit_reached";
      run.terminationReason =
        `Execution limit of ${maxSteps} tool steps reached. ` +
        `No model-generated conclusion was produced. ` +
        `Review the ${run.evidence.length} evidence item(s) collected above.`;
    }

    return run;
  } catch (err) {
    console.error("--- AI SDK ERROR ---", err);
    run.error = err instanceof Error ? err.message : "Investigation failed unexpectedly.";
    run.status = "failed";
    if (!run.terminationReason) run.terminationReason = "Run aborted by an unexpected error.";
    return run;
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(maxSteps: number): string {
  return [
    "You are an SRE incident investigator AI agent.",
    "Investigate the given objective by calling observability tools to gather evidence.",
    "",
    "Rules:",
    "1. Call one tool per response. Do not include explanatory text before a tool call.",
    "2. After each tool result, decide whether you need more evidence or can conclude.",
    `3. You have at most ${maxSteps} tool calls available. Use them efficiently.`,
    "4. When you have sufficient evidence, produce ONLY a JSON final report — no other text:",
    '   {"rootCause":"string","confidence":"high|medium|low","remediation":["action"],"unknowns":["open question"]}',
    "5. Do NOT include chain-of-thought, reasoning, or any text outside the JSON in your final response.",
    "6. Ground every field in the JSON report on evidence from the tool results you received.",
    "7. If a tool call fails, adapt your arguments or try a different tool — do not repeat the same failing call.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Conclusion parsing
// ---------------------------------------------------------------------------

const conclusionSchema = z.object({
  rootCause: z.string(),
  confidence: z.string(),
  remediation: z.array(z.string()),
  unknowns: z.array(z.string()),
});

/**
 * Parses the model's final text as a JSON conclusion.
 * Falls back gracefully if the text is not valid JSON or doesn't match the schema:
 * the raw text becomes the rootCause so the run never silently loses data.
 */
function parseConclusion(text: string) {
  // Strip optional markdown fences.
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1) {
    try {
      const parsed = conclusionSchema.safeParse(
        JSON.parse(cleaned.slice(start, end + 1)),
      );
      if (parsed.success) return parsed.data;
    } catch {
      // Fall through to text fallback.
    }
  }

  return {
    rootCause: text.trim() || "Agent produced no readable conclusion.",
    confidence: "unstructured",
    remediation: [] as string[],
    unknowns: [] as string[],
  };
}

// ---------------------------------------------------------------------------
// Evidence summarisation helpers
// ---------------------------------------------------------------------------

/**
 * Builds a short, factual finding from a tool's output and inputs.
 * Derived deterministically from structured data — no model involvement.
 */
function summarizeToolOutput(toolName: string, args: unknown, output: unknown): string {
  const a = args as Record<string, unknown>;
  const o =
    output !== null && typeof output === "object"
      ? (output as Record<string, unknown>)
      : {};

  switch (toolName) {
    case "search_logs":
      return `${a["service"]}: ${o["matched"] ?? 0} log line(s) matched "${a["query"]}"`;

    case "get_metrics":
      return `${a["service"]} ${a["metric"]}: ${o["value"] ?? "N/A"}`;

    case "get_service_status":
      return (
        `${a["service"]}: health=${o["health"] ?? "unknown"}` +
        (o["last_deploy"] ? `, last deploy ${o["last_deploy"]}` : "")
      );

    default:
      return `${toolName}(${a["service"] ?? "?"}): ${JSON.stringify(output).slice(0, 120)}`;
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ---------------------------------------------------------------------------
// Re-export evidence type so callers don't need an extra import
// ---------------------------------------------------------------------------
export type { EvidenceItem, InvestigationRun, TraceStep };
