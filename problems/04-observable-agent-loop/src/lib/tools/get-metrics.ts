import { z } from "zod";
import { ToolExecutionError, type ToolSpec } from "./types";
import { KNOWN_SERVICES, METRICS } from "./synthetic-data";

export const getMetricsSchema = z.object({
  service: z.string().describe("Service name, e.g. payment-service"),
  metric: z
    .string()
    .describe("One of: error_rate, latency_p99, throughput, saturation"),
  window: z
    .string()
    .describe("Time window string, e.g. 15m, 1h, 24h"),
});

export const getMetricsTool: ToolSpec = {
  name: "get_metrics",
  description:
    "Read a time-series metric for a service. Supported metrics: error_rate, latency_p99, throughput, saturation.",
  schema: getMetricsSchema,

  execute(input: unknown) {
    const { service, metric, window } = getMetricsSchema.parse(input);

    if (!(KNOWN_SERVICES as readonly string[]).includes(service)) {
      throw new ToolExecutionError(
        `unknown_service: "${service}" is not registered. Known services: ${KNOWN_SERVICES.join(", ")}`,
      );
    }

    const serviceMetrics = METRICS[service];
    const value = serviceMetrics?.[metric];

    if (value === undefined) {
      const available = Object.keys(serviceMetrics ?? {}).join(", ") || "none";
      throw new ToolExecutionError(
        `unknown_metric: "${metric}" is not collected for ${service}. Available metrics: ${available}`,
      );
    }

    return { service, metric, window, value };
  },
};
