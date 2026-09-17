/**
 * Deterministic agent runner tests using FakeScriptedAdapter.
 * No API key, no network access required.
 *
 * Uses Node's built-in test runner (node:test) — no extra packages needed.
 *
 * Run with:
 *   node --experimental-strip-types --test src/tests/agent-runner.test.ts
 *
 * Or via npm/bun:  npm test  /  bun test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runAgentLoop } from "../lib/agent/runner.ts";
import { FakeScriptedAdapter } from "../lib/agent/fake-adapter.ts";
import { ToolRegistry } from "../lib/tools/registry.ts";
import { searchLogsTool } from "../lib/tools/search-logs.ts";
import { getMetricsTool } from "../lib/tools/get-metrics.ts";
import { getServiceStatusTool } from "../lib/tools/get-service-status.ts";

// ---------------------------------------------------------------------------
// Test fixture: registry pre-loaded with all three tools
// ---------------------------------------------------------------------------

function makeRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(searchLogsTool);
  r.register(getMetricsTool);
  r.register(getServiceStatusTool);
  return r;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentLoop", () => {
  // -------------------------------------------------------------------------
  // Test 1: Multi-step tool usage + successful final response
  // -------------------------------------------------------------------------
  it("resolves after multi-step tool usage with a valid conclusion", async () => {
    const finalJson =
      '{"rootCause":"Deploy v3.14.2 reduced connection pool from 200 to 50","confidence":"high","remediation":["Roll back deploy v3.14.2"],"unknowns":[]}';

    const adapter = new FakeScriptedAdapter([
      {
        kind: "tool_call",
        toolName: "get_service_status",
        args: { service: "payment-service" },
      },
      {
        kind: "tool_call",
        toolName: "search_logs",
        args: { service: "payment-service", query: "error", limit: 5 },
      },
      { kind: "final_text", text: finalJson },
    ]);

    const run = await runAgentLoop("Investigate payment failures", adapter, makeRegistry(), 6);

    assert.equal(run.status, "resolved");
    assert.equal(run.stepsUsed, 2); // two tool calls, not counting the decision step
    assert.equal(adapter.totalCalls, 3); // 2 tool rounds + 1 final-text round
    assert.equal(run.steps.length, 3); // 2 tool steps + 1 decision step
    assert.equal(run.steps[0]!.phase, "tool");
    assert.equal(run.steps[1]!.phase, "tool");
    assert.equal(run.steps[2]!.phase, "decision");
    assert.equal(run.evidence.length, 2);
    assert.notEqual(run.conclusion, null);
    assert.ok(run.conclusion!.rootCause.includes("connection pool"));
    assert.equal(run.conclusion!.confidence, "high");
    assert.equal(run.conclusion!.remediation.length, 1);
  });

  // -------------------------------------------------------------------------
  // Test 2: Execution limit — no extra model call after limit
  // -------------------------------------------------------------------------
  it("stops exactly at maxSteps and makes NO extra adapter call", async () => {
    // Script supplies 10 tool calls but maxSteps = 3 — only 3 should execute.
    const infiniteCalls = Array.from({ length: 10 }, () => ({
      kind: "tool_call" as const,
      toolName: "get_service_status",
      args: { service: "payment-service" },
    }));

    const adapter = new FakeScriptedAdapter(infiniteCalls);
    const maxSteps = 3;

    const run = await runAgentLoop("Investigate", adapter, makeRegistry(), maxSteps);

    assert.equal(run.status, "limit_reached");
    assert.equal(run.stepsUsed, maxSteps);
    // Critical: exactly maxSteps adapter calls — NOT maxSteps + 1.
    // maxSteps + 1 would mean the runner made an extra synthesis/conclusion call.
    assert.equal(adapter.totalCalls, maxSteps);
    // conclusion must be null: no model-generated conclusion was produced.
    assert.equal(run.conclusion, null);
    assert.ok(run.terminationReason.length > 0);
    // Evidence should have been collected for every step that ran.
    assert.equal(run.evidence.length, maxSteps);
  });

  // -------------------------------------------------------------------------
  // Test 3: Tool argument validation failure (errorKind = "validation")
  // -------------------------------------------------------------------------
  it("records validation failure and continues the loop", async () => {
    const adapter = new FakeScriptedAdapter([
      {
        kind: "tool_call",
        toolName: "search_logs",
        // limit must be a number; passing a string fails z.number().int()
        args: { service: "payment-service", query: "error", limit: "not-a-number" },
      },
      {
        kind: "tool_call",
        toolName: "search_logs",
        args: { service: "payment-service", query: "error", limit: 5 },
      },
      {
        kind: "final_text",
        text: '{"rootCause":"Connection pool exhausted","confidence":"high","remediation":[],"unknowns":[]}',
      },
    ]);

    const run = await runAgentLoop("Investigate", adapter, makeRegistry(), 6);

    assert.equal(run.status, "resolved");
    // First step: validation failure
    assert.equal(run.steps[0]!.errorKind, "validation");
    assert.equal(run.steps[0]!.validated, false);
    assert.ok(run.steps[0]!.error !== null);
    // Second step: successful recovery
    assert.equal(run.steps[1]!.errorKind, null);
    assert.equal(run.steps[1]!.validated, true);
    assert.equal(run.steps[1]!.error, null);
    // Evidence only from the one successful step
    assert.equal(run.evidence.length, 1);
  });

  // -------------------------------------------------------------------------
  // Test 4: Tool execution failure (errorKind = "execution")
  // -------------------------------------------------------------------------
  it("records execution failure (unknown service) and continues the loop", async () => {
    const adapter = new FakeScriptedAdapter([
      {
        kind: "tool_call",
        toolName: "search_logs",
        // "xyz-service" passes Zod validation (it's a string) but assertService() throws
        args: { service: "xyz-nonexistent-service", query: "error", limit: 5 },
      },
      {
        kind: "tool_call",
        toolName: "get_service_status",
        args: { service: "payment-service" },
      },
      {
        kind: "final_text",
        text: '{"rootCause":"Deploy issue","confidence":"medium","remediation":[],"unknowns":[]}',
      },
    ]);

    const run = await runAgentLoop("Investigate", adapter, makeRegistry(), 6);

    assert.equal(run.status, "resolved");
    // First step: args were valid schema-wise, but execution failed at domain level
    assert.equal(run.steps[0]!.errorKind, "execution");
    assert.equal(run.steps[0]!.validated, true); // schema passed
    assert.ok(run.steps[0]!.error!.includes("unknown_service"));
    // Second step: clean recovery with a known service
    assert.equal(run.steps[1]!.errorKind, null);
    assert.equal(run.steps[1]!.validated, true);
    // No evidence from the failed step; 1 from the successful one
    assert.equal(run.evidence.length, 1);
  });

  // -------------------------------------------------------------------------
  // Test 5: Unknown tool (errorKind = "validation")
  // -------------------------------------------------------------------------
  it("records unknown tool as validation error and continues", async () => {
    const adapter = new FakeScriptedAdapter([
      {
        kind: "tool_call",
        toolName: "nonexistent_observability_tool",
        args: { foo: "bar" },
      },
      {
        kind: "tool_call",
        toolName: "get_service_status",
        args: { service: "payment-service" },
      },
      {
        kind: "final_text",
        text: '{"rootCause":"Deploy","confidence":"low","remediation":[],"unknowns":[]}',
      },
    ]);

    const run = await runAgentLoop("Investigate", adapter, makeRegistry(), 6);

    assert.equal(run.steps[0]!.errorKind, "validation");
    assert.ok(run.steps[0]!.error!.includes("unknown_tool"));
    assert.equal(run.steps[0]!.tool, "nonexistent_observability_tool");
    // Loop continued: second step succeeded
    assert.equal(run.steps[1]!.error, null);
    assert.equal(run.status, "resolved");
  });

  // -------------------------------------------------------------------------
  // Test 6: Step phases, indices, and decisionSummary are correct
  // -------------------------------------------------------------------------
  it("assigns correct phases, indices, and decisionSummary to each step", async () => {
    const adapter = new FakeScriptedAdapter([
      {
        kind: "tool_call",
        toolName: "get_service_status",
        args: { service: "payment-service" },
      },
      {
        kind: "final_text",
        text: '{"rootCause":"Deploy","confidence":"high","remediation":[],"unknowns":[]}',
      },
    ]);

    const run = await runAgentLoop("Investigate", adapter, makeRegistry(), 6);

    assert.equal(run.steps.length, 2);
    assert.equal(run.steps[0]!.index, 1);
    assert.equal(run.steps[0]!.phase, "tool");
    assert.equal(run.steps[0]!.tool, "get_service_status");
    assert.ok(run.steps[0]!.decisionSummary.length > 0);
    assert.ok(run.steps[0]!.durationMs >= 0);
    assert.equal(run.steps[1]!.index, 2);
    assert.equal(run.steps[1]!.phase, "decision");
    assert.equal(run.steps[1]!.tool, null);
    // Only tool-call steps count toward stepsUsed
    assert.equal(run.stepsUsed, 1);
  });

  // -------------------------------------------------------------------------
  // Test 7: Evidence is collected only from successful tool executions
  // -------------------------------------------------------------------------
  it("accumulates evidence only from successful tool executions", async () => {
    const adapter = new FakeScriptedAdapter([
      // Fails: unknown service (execution error)
      { kind: "tool_call", toolName: "search_logs", args: { service: "bad-svc", query: "err", limit: 5 } },
      // Fails: limit = 0 fails z.number().min(1) (validation error)
      { kind: "tool_call", toolName: "search_logs", args: { service: "payment-service", query: "error", limit: 0 } },
      // Succeeds
      { kind: "tool_call", toolName: "get_service_status", args: { service: "payment-service" } },
      { kind: "final_text", text: '{"rootCause":"Deploy","confidence":"high","remediation":[],"unknowns":[]}' },
    ]);

    const run = await runAgentLoop("Investigate", adapter, makeRegistry(), 6);

    // Only 1 evidence item — from the single successful call
    assert.equal(run.evidence.length, 1);
    assert.ok(run.evidence[0]!.source.includes("get_service_status"));
    assert.equal(run.status, "resolved");
  });
});
