import { z } from "zod";
import { ToolExecutionError, type ToolSpec } from "./types";
import { KNOWN_SERVICES, LOGS } from "./synthetic-data";

export const searchLogsSchema = z.object({
  service: z.string().describe("Service name, e.g. payment-service"),
  query: z
    .string()
    .describe("Substring or level filter, e.g. error, timeout. Use * or empty string for all lines."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe("Maximum number of log lines to return (1–20)"),
});

export const searchLogsTool: ToolSpec = {
  name: "search_logs",
  description:
    "Search recent application logs for a service. Returns timestamped log lines matching the query.",
  schema: searchLogsSchema,

  execute(input: unknown) {
    const { service, query, limit } = searchLogsSchema.parse(input);

    if (!(KNOWN_SERVICES as readonly string[]).includes(service)) {
      throw new ToolExecutionError(
        `unknown_service: "${service}" is not registered. Known services: ${KNOWN_SERVICES.join(", ")}`,
      );
    }

    const q = query.toLowerCase();
    const allLines = LOGS[service] ?? [];
    const matched =
      q === "" || q === "*"
        ? allLines
        : allLines.filter((line) => line.toLowerCase().includes(q));

    return {
      service,
      query,
      matched: matched.length,
      lines: matched.slice(0, limit),
    };
  },
};
