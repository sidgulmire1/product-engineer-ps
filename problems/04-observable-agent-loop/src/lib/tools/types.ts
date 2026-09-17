import type { ZodSchema } from "zod";

/**
 * ToolSpec is the single contract that every tool must satisfy.
 * It is intentionally decoupled from any model/AI-SDK types:
 *   - `schema` is a Zod schema used for runtime input validation in the runner.
 *   - `execute` is the pure implementation that reads from synthetic data.
 * Model adapters receive ToolSpec objects and extract only name/description/schema
 * to build their own provider-specific tool maps.
 */
export type ToolSpec = {
  /** Unique identifier used in model tool-call responses. */
  name: string;
  /** Human-readable description sent to the model. */
  description: string;
  /** Zod schema — validated by the runner before execute() is called. */
  schema: ZodSchema;
  /** Pure implementation. May throw ToolExecutionError on domain failures. */
  execute(input: unknown): Promise<unknown> | unknown;
};

/**
 * Thrown by a tool implementation when the request is structurally valid
 * but cannot be fulfilled (e.g., unknown service name, missing metric).
 * Distinct from a Zod ValidationError, which means the arguments themselves
 * are malformed. The runner catches both and records them with different errorKind.
 */
export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
