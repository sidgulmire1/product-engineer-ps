import type { ModelRequest, ModelResponse } from "./types";

/**
 * ModelAdapter is the single interface the agent runner calls.
 * Each provider (Nemotron, fake/scripted) implements this interface.
 *
 * Contracts:
 *   - complete() returns either a tool_call or final_text — never raw reasoning.
 *   - The adapter is responsible for converting ModelRequest into its
 *     provider-specific wire format and back.
 *   - execute() is NEVER called by the adapter — that is the runner's job.
 *   - If the underlying API call fails, the adapter lets the exception propagate;
 *     the runner's outer try/catch records it as status "failed".
 */
export interface ModelAdapter {
  /** Identifies the model in InvestigationRun.model (e.g. "nvidia/llama-3.1-nemotron-70b-instruct"). */
  readonly name: string;

  /** Produce one model completion given the current conversation state and available tools. */
  complete(req: ModelRequest): Promise<ModelResponse>;
}
