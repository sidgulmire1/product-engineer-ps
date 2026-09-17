import type { ToolSpec } from "../tools/types";

// ---------------------------------------------------------------------------
// Trace types — the ordered operational record of the run
// ---------------------------------------------------------------------------

/**
 * A single recorded step in the agent execution trace.
 * Contains ONLY operational information — no chain-of-thought or hidden reasoning.
 *
 * - phase "tool"     : the model requested a tool call; runner validated + executed it.
 * - phase "decision" : the model produced a final response (no more tool calls).
 */
export type TraceStep = {
  /** 1-based sequential index within the run. */
  index: number;
  /** "tool" for tool-call steps; "decision" for the final response step. */
  phase: "decision" | "tool";
  /**
   * Brief, structured, human-readable summary of what this step did.
   * Derived from tool name + key arguments (e.g. "search_logs(payment-service, error, 10)").
   * Never contains model reasoning or chain-of-thought.
   */
  decisionSummary: string;
  /** Tool name for tool-call steps; null for decision steps. */
  tool: string | null;
  /** JSON-serialised validated arguments, or null if validation failed / not a tool step. */
  input: string | null;
  /** JSON-serialised tool output, or the model's final text for decision steps. */
  output: string | null;
  /** Error message if the step failed (validation or execution). */
  error: string | null;
  /** "validation" = Zod schema rejected the args; "execution" = tool.execute() threw. */
  errorKind: "validation" | "execution" | null;
  /** True when tool arguments passed schema validation (even if execute later failed). */
  validated: boolean;
  /** Wall-clock milliseconds for the full step (model call + tool execution). */
  durationMs: number;
};

/** A single piece of evidence extracted from a successful tool result. */
export type EvidenceItem = {
  /** Short factual finding derived deterministically from the tool output. */
  finding: string;
  /** Citation: "step N · tool_name". */
  source: string;
};

/** The model-generated conclusion at the end of a resolved run. */
export type Conclusion = {
  rootCause: string;
  confidence: string;
  remediation: string[];
  unknowns: string[];
};

/**
 * The complete result of one investigation run.
 * Returned by runAgentLoop() and serialised back to the frontend.
 */
export type InvestigationRun = {
  objective: string;
  model: string;
  maxSteps: number;
  /** Number of tool-call steps actually consumed. Does NOT count the final decision step. */
  stepsUsed: number;
  status: "resolved" | "limit_reached" | "failed";
  terminationReason: string;
  steps: TraceStep[];
  /** Factual evidence items collected from successful tool executions. */
  evidence: EvidenceItem[];
  /**
   * Model-generated conclusion.
   * null when status is "limit_reached" (no model call was made at the limit).
   */
  conclusion: Conclusion | null;
  /** Top-level error message for status "failed". */
  error: string | null;
};

// ---------------------------------------------------------------------------
// Model adapter interface types — shared between runner and adapters
// ---------------------------------------------------------------------------

/** A single message in the conversation history passed to model adapters. */
export type ConversationMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      /** Brief summary text (not reasoning). Used for the conversation turn label. */
      content: string;
      toolCall?: ToolCallRecord;
    }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      /** The raw output from ToolSpec.execute(), or an error object. */
      result: unknown;
    };

/** Identifies a single model-requested tool invocation. */
export type ToolCallRecord = {
  toolCallId: string;
  toolName: string;
  /** Raw args from the model — will be validated by the runner before use. */
  args: unknown;
};

/**
 * Everything a ModelAdapter needs to produce one completion.
 * `tools` is the full ToolSpec list; adapters use name/description/schema only.
 * The runner never passes execute() responsibilities to the adapter.
 */
export type ModelRequest = {
  systemPrompt: string;
  messages: ConversationMessage[];
  tools: ToolSpec[];
};

/**
 * The two possible outcomes of a single adapter.complete() call.
 * Adapters must never return raw chain-of-thought.
 */
export type ModelResponse =
  | {
      kind: "tool_call";
      toolCall: ToolCallRecord;
      /** Structured summary for the trace, e.g. "search_logs(payment-service, error, 10)". */
      decisionSummary: string;
    }
  | {
      kind: "final_text";
      text: string;
      decisionSummary: string;
    };
