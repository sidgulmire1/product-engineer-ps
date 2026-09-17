import { z } from "zod";
import { ToolExecutionError, type ToolSpec } from "./types";
import { KNOWN_SERVICES, STATUS } from "./synthetic-data";

export const getServiceStatusSchema = z.object({
  service: z.string().describe("Service name, e.g. payment-service"),
});

export const getServiceStatusTool: ToolSpec = {
  name: "get_service_status",
  description:
    "Get current health, recent deploy history, dependency health, and open alerts for a service.",
  schema: getServiceStatusSchema,

  execute(input: unknown) {
    const { service } = getServiceStatusSchema.parse(input);

    if (!(KNOWN_SERVICES as readonly string[]).includes(service)) {
      throw new ToolExecutionError(
        `unknown_service: "${service}" is not registered. Known services: ${KNOWN_SERVICES.join(", ")}`,
      );
    }

    // Return status with service name embedded so callers don't lose context.
    return { service, ...(STATUS[service] as object) };
  },
};
