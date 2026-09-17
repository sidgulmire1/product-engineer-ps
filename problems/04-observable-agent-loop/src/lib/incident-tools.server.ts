import { z } from "zod";

/**
 * Simulated observability backends for the incident investigator.
 * Each tool has a strict input schema, is validated before execution,
 * and can fail (unknown service / unknown metric) so the agent has to adapt.
 */

const KNOWN_SERVICES = [
  "payment-service",
  "checkout-api",
  "auth-service",
  "ledger-db",
  "stripe-gateway",
] as const;

export const searchLogsInput = z.object({
  service: z.string().describe("Service name, e.g. payment-service"),
  query: z.string().describe("Substring or level filter, e.g. error, timeout"),
  limit: z.number().int().describe("Max log lines to return, 1-20"),
});

export const getMetricsInput = z.object({
  service: z.string().describe("Service name"),
  metric: z
    .string()
    .describe("One of: error_rate, latency_p99, throughput, saturation"),
  window: z.string().describe("Time window, e.g. 15m, 1h, 24h"),
});

export const getServiceStatusInput = z.object({
  service: z.string().describe("Service name"),
});

export const TOOL_CATALOG = [
  {
    name: "search_logs",
    description:
      "Search recent application logs for a service. Returns timestamped log lines.",
    schema: searchLogsInput,
    args: "service, query, limit",
  },
  {
    name: "get_metrics",
    description:
      "Read a time-series metric for a service (error_rate, latency_p99, throughput, saturation).",
    schema: getMetricsInput,
    args: "service, metric, window",
  },
  {
    name: "get_service_status",
    description:
      "Get current health, deploy history and dependency status for a service.",
    schema: getServiceStatusInput,
    args: "service",
  },
] as const;

export class ToolExecutionError extends Error {}

function assertService(service: string) {
  if (!(KNOWN_SERVICES as readonly string[]).includes(service)) {
    throw new ToolExecutionError(
      `unknown_service: "${service}" is not registered. Known services: ${KNOWN_SERVICES.join(", ")}`,
    );
  }
}

const LOGS: Record<string, string[]> = {
  "payment-service": [
    "10:41:02 ERROR charge.create failed: upstream timeout after 5000ms (stripe-gateway)",
    "10:41:02 WARN  connection pool exhausted: 50/50 in use, 128 waiters",
    "10:41:07 ERROR charge.create failed: upstream timeout after 5000ms (stripe-gateway)",
    "10:41:15 INFO  retry budget exhausted for tenant batch eu-west",
    "10:40:58 INFO  deploy v3.14.2 completed, connection pool max=50 (was 200)",
    "10:42:31 ERROR 503 returned to checkout-api, 61% of requests failing",
    "10:43:00 WARN  circuit breaker half-open for stripe-gateway",
  ],
  "checkout-api": [
    "10:41:10 ERROR payment-service returned 503 (order 88213)",
    "10:41:44 WARN  cart abandonment spike detected",
  ],
  "stripe-gateway": [
    "10:41:00 INFO  outbound calls healthy, p99 210ms",
    "10:42:00 INFO  no upstream provider incidents reported",
  ],
  "auth-service": ["10:40:00 INFO  nominal"],
  "ledger-db": [
    "10:41:05 WARN  slow query: SELECT ... FROM payments WHERE state='pending' (1.9s)",
  ],
};

const METRICS: Record<string, Record<string, string>> = {
  "payment-service": {
    error_rate: "0.4% -> 61.2% (step change at 10:41, right after deploy v3.14.2)",
    latency_p99: "180ms -> 5000ms (saturated at client timeout ceiling)",
    throughput: "1,240 rps -> 470 rps successful",
    saturation: "connection pool utilization 100%, 128 requests queued",
  },
  "stripe-gateway": {
    error_rate: "0.2% (flat, no anomaly)",
    latency_p99: "210ms (flat)",
    throughput: "460 rps inbound from payment-service (down from 1,230)",
    saturation: "12%",
  },
  "checkout-api": {
    error_rate: "0.3% -> 38.0%",
    latency_p99: "300ms -> 5200ms",
    throughput: "980 rps",
    saturation: "34%",
  },
  "auth-service": {
    error_rate: "0.1%",
    latency_p99: "90ms",
    throughput: "2,100 rps",
    saturation: "22%",
  },
  "ledger-db": {
    error_rate: "0.0%",
    latency_p99: "1900ms on pending-payments query",
    throughput: "3,400 qps",
    saturation: "71%",
  },
};

const STATUS: Record<string, unknown> = {
  "payment-service": {
    health: "degraded",
    last_deploy: "v3.14.2 at 10:40:58 (config change: db.pool.max 200 -> 50)",
    previous_deploy: "v3.14.1 at 08:12:00 (healthy)",
    dependencies: { "stripe-gateway": "healthy", "ledger-db": "healthy" },
    open_alerts: ["PaymentErrorRateHigh", "PaymentPoolExhausted"],
  },
  "checkout-api": {
    health: "degraded",
    last_deploy: "v2.9.0 at 06:00:00",
    dependencies: { "payment-service": "degraded" },
    open_alerts: ["CheckoutFailureRate"],
  },
  "stripe-gateway": {
    health: "healthy",
    last_deploy: "v1.4.0 two days ago",
    dependencies: {},
    open_alerts: [],
  },
  "auth-service": { health: "healthy", dependencies: {}, open_alerts: [] },
  "ledger-db": {
    health: "healthy",
    dependencies: {},
    open_alerts: ["SlowQueryPendingPayments"],
  },
};

export async function executeTool(name: string, input: unknown) {
  switch (name) {
    case "search_logs": {
      const { service, query, limit } = searchLogsInput.parse(input);
      assertService(service);
      const q = query.toLowerCase();
      const lines = (LOGS[service] ?? []).filter(
        (l) => q === "" || q === "*" || l.toLowerCase().includes(q),
      );
      return {
        service,
        query,
        matched: lines.length,
        lines: lines.slice(0, Math.max(1, Math.min(limit || 10, 20))),
      };
    }
    case "get_metrics": {
      const { service, metric, window } = getMetricsInput.parse(input);
      assertService(service);
      const value = METRICS[service]?.[metric];
      if (!value) {
        throw new ToolExecutionError(
          `unknown_metric: "${metric}" not collected for ${service}. Available: ${Object.keys(
            METRICS[service] ?? {},
          ).join(", ")}`,
        );
      }
      return { service, metric, window, value };
    }
    case "get_service_status": {
      const { service } = getServiceStatusInput.parse(input);
      assertService(service);
      return STATUS[service];
    }
    default:
      throw new ToolExecutionError(`unknown_tool: "${name}" is not available`);
  }
}
