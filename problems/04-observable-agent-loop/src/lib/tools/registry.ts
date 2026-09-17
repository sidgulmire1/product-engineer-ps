import type { ToolSpec } from "./types";
import { searchLogsTool } from "./search-logs";
import { getMetricsTool } from "./get-metrics";
import { getServiceStatusTool } from "./get-service-status";

/**
 * ToolRegistry holds all registered tools.
 * The runner uses it to:
 *   1. Validate model-requested tool names (lookup by name)
 *   2. Validate tool arguments (spec.schema.safeParse)
 *   3. Execute tools (spec.execute)
 *
 * Model adapters receive the full ToolSpec list and extract
 * name/description/schema to build their provider-specific tool maps.
 * They do NOT call execute() — that is the runner's responsibility.
 */
export class ToolRegistry {
  private readonly specs = new Map<string, ToolSpec>();

  register(spec: ToolSpec): this {
    this.specs.set(spec.name, spec);
    return this;
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.get(name);
  }

  list(): ToolSpec[] {
    return [...this.specs.values()];
  }
}

/**
 * Creates and returns the default registry pre-loaded with all
 * three incident-investigation tools.
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(searchLogsTool);
  registry.register(getMetricsTool);
  registry.register(getServiceStatusTool);
  return registry;
}
