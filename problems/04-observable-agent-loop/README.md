# Problem 4: Observable Agent Loop

## AI Incident Investigator

An observable AI-powered incident investigation agent that investigates service failures using structured tool calls, maintains an ordered execution trace, collects evidence, handles tool failures, and enforces configurable execution limits.

The implementation uses a real agent loop with model-driven tool selection rather than a hard-coded sequence of tool calls.

## Objective

Build an observable incident investigation agent that can:

1. Receive an investigation objective.
2. Select an appropriate tool with structured input.
3. Execute the selected tool.
4. Return the tool result to the agent loop.
5. Perform multi-step tool use.
6. Produce a final response grounded in collected evidence.
7. Record an ordered trace of model decisions, tool calls, tool results, errors, and the final response.
8. Handle deliberate tool failures.
9. Enforce a configurable execution limit.

## Available Tools

The application provides three tools backed by synthetic incident data:

- `search_logs` — Search service logs.
- `get_metrics` — Retrieve service metrics.
- `get_service_status` — Retrieve service health, deployment information, dependencies, and open alerts.

## Agent Flow

```text
Investigation Objective
        ↓
Model Decision
        ↓
Structured Tool Call
        ↓
Tool Validation
        ↓
Tool Execution
        ↓
Tool Result / Error
        ↓
Trace + Evidence + State
        ↓
Model Decision
        ↓
Next Tool Call / Final Response
