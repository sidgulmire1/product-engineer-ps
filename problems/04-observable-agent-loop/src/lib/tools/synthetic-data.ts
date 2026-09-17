/**
 * Synthetic observability data for the incident investigator.
 * Represents a real production incident: a misconfigured deploy to payment-service
 * that drastically reduced the connection pool, causing cascading failures.
 *
 * This data is intentionally deterministic so investigation outcomes are
 * reproducible and the agent always finds a clear root cause.
 */

export const KNOWN_SERVICES = [
  "payment-service",
  "checkout-api",
  "auth-service",
  "ledger-db",
  "stripe-gateway",
] as const;

export type KnownService = (typeof KNOWN_SERVICES)[number];

export const LOGS: Record<string, string[]> = {
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

export const METRICS: Record<string, Record<string, string>> = {
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

export const STATUS: Record<string, unknown> = {
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
