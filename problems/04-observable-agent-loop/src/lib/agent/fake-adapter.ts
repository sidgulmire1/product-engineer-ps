import type { ModelAdapter } from "./model-adapter";
import type { ModelRequest, ModelResponse, ToolCallRecord } from "./types";

// ---------------------------------------------------------------------------
// Script entry types
// ---------------------------------------------------------------------------

export type ScriptedToolCall = {
  kind: "tool_call";
  toolName: string;
  args: Record<string, unknown>;
};

export type ScriptedFinalText = {
  kind: "final_text";
  text: string;
};

export type ScriptedStep = ScriptedToolCall | ScriptedFinalText;

// ---------------------------------------------------------------------------
// FakeScriptedAdapter
// ---------------------------------------------------------------------------

/**
 * A deterministic ModelAdapter that replays a pre-written script of responses.
 * Used exclusively in automated tests — requires no API key or network access.
 *
 * Behaviour:
 *   - Each call to complete() advances through the script in order.
 *   - If the script is exhausted before the runner stops, complete() returns a
 *     synthetic "final_text" response so the loop terminates cleanly.
 *   - totalCalls is exposed so tests can assert that no extra model calls
 *     were made after the execution limit was reached.
 *
 * @example
 * const adapter = new FakeScriptedAdapter([
 *   { kind: "tool_call", toolName: "get_service_status", args: { service: "payment-service" } },
 *   { kind: "final_text", text: '{"rootCause":"...","confidence":"high","remediation":[],"unknowns":[]}' },
 * ]);
 */
export class FakeScriptedAdapter implements ModelAdapter {
  readonly name = "fake/scripted";

  private callCount = 0;
  private readonly script: ScriptedStep[];

  constructor(script: ScriptedStep[]) {
    this.script = script;
  }

  /** Total number of times complete() has been called. Used in limit assertions. */
  get totalCalls(): number {
    return this.callCount;
  }

  // The request is ignored — the adapter is fully scripted.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(_req: ModelRequest): Promise<ModelResponse> {
    const step: ScriptedStep = this.script[this.callCount] ?? {
      kind: "final_text",
      text: "Script exhausted — no further scripted steps.",
    };
    this.callCount++;

    if (step.kind === "tool_call") {
      const call: ToolCallRecord = {
        toolCallId: `fake-call-${this.callCount}`,
        toolName: step.toolName,
        args: step.args,
      };
      return {
        kind: "tool_call",
        toolCall: call,
        decisionSummary: buildToolSummary(step.toolName, step.args),
      };
    }

    return {
      kind: "final_text",
      text: step.text,
      decisionSummary: "Agent produced final response.",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildToolSummary(toolName: string, args: Record<string, unknown>): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return `${toolName}(${argStr})`;
}
