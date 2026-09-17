# Problem 4: Observable Agent Loop
- **Name:** Siddharth Laxmikant Gulmire
- **Email:** siddgulmire1@gmail.com
- **GitHub:** https://github.com/sidgulmire1
- **Selected problem:** Problem 4 — Observable Agent Loop
- **Demo video:** https://drive.google.com/file/d/1iFg96urtAzDUlWkGPOzAuN7W5axKvmCc/view?usp=sharing


## 1. Overview

This project implements an observable AI incident-investigation agent.

The agent receives an investigation objective, uses a model to select appropriate tools, validates structured tool arguments, executes tools against synthetic incident data, records an ordered operational trace, accumulates successful results as evidence, and continues the investigation until a final response is produced or the configured execution limit is reached.

The implementation uses a real control loop rather than a hard-coded sequence of tool calls.

---

## 2. How to Run

### Install dependencies

```bash
npm install
```

### Environment configuration

The application requires the model/API configuration expected by the local project environment.

Create the required local environment file and provide the required credentials there.

**Do not commit `.env`, API keys, or other secrets to the repository.**

### Start the application

```bash
npm run dev
```

Open the local URL displayed by the development server.

### Run automated tests

```bash
npm test
```

### Run the production build

```bash
npm run build
```

---

## 3. Architecture

The implementation separates the model, tools, orchestration, validation, and presentation responsibilities.

### Model

`ModelAdapter` provides the model interface through:

```text
complete(req: ModelRequest): Promise<ModelResponse>
```

The production implementation uses `NemotronAdapter`.

Automated tests use `FakeScriptedAdapter`, allowing the agent loop to be tested deterministically without a live model API.

### Tools

Tools are represented using `ToolSpec` and managed through `ToolRegistry`.

Each tool provides:

* a tool name
* a Zod input schema
* an execution function

### Agent Runner

`runAgentLoop` is responsible for:

* maintaining conversation state
* requesting model decisions
* validating tool calls
* executing tools
* recording trace events
* accumulating evidence
* enforcing execution limits
* producing the final response

### API Boundary

The frontend invokes the investigation through the application's server function.

The server constructs the model adapter and tool registry and starts the agent runner.

---

## 4. Agent Execution Flow

The core execution flow is:

```text
User objective
      ↓
Model decision
      ↓
AI SDK parsed tool call
      ↓
Tool name validation
      ↓
Zod argument validation
      ↓
Tool execution
      ↓
Tool result
      ↓
Record trace event
      ↓
Add successful result to evidence
      ↓
Add result to conversation state
      ↓
Model decision
      ↓
...
      ↓
Final response
```

If the configured execution limit is reached before the model produces a final response, the loop terminates without making another model or tool call.

---

## 5. Available Tools

The default registry contains three tools backed by synthetic incident data.

### `search_logs`

Searches timestamped application logs for a service.

Input:

```text
service: string
query: string
limit: integer (1–20)
```

Returns information about matching log lines.

An unknown service produces a tool execution error.

### `get_metrics`

Retrieves a metric for a service over a specified time window.

Input:

```text
service: string
metric: string
window: string
```

Returns the requested metric information.

An unknown service or unavailable metric produces a tool execution error.

### `get_service_status`

Retrieves service health, deployment history, dependencies, and open alerts.

Input:

```text
service: string
```

An unknown service produces a tool execution error.

---

## 6. Tool Argument Validation

Tool arguments are validated before execution.

The runner first verifies that the requested tool exists in the `ToolRegistry`.

It then validates the parsed arguments against the tool's Zod schema using `safeParse()`.

If validation fails:

1. The tool is not executed.
2. A validation error is recorded in the trace.
3. The failure is returned to the model as execution context.

This creates a strict boundary between model-generated arguments and application-side tool execution.

---

## 7. Model / AI SDK Integration

The production model is accessed through `NemotronAdapter`.

The current implementation uses:

* `ai`
* `@ai-sdk/openai-compatible`
* `zod`

The installed versions are currently:

```text
ai: ^7.0.105
@ai-sdk/openai-compatible: ^3.0.51
zod: ^3.25.76
```

Tool definitions are mapped to the AI SDK using the `inputSchema` API.

The provider's raw tool-call arguments are parsed by the AI SDK before they reach the agent runner.

For example:

```text
Nemotron raw response
arguments: "{\"service\":\"payment-service\"}"
```

is parsed into a structured tool call containing:

```json
{
  "service": "payment-service"
}
```

The populated argument is then validated by the application's Zod schema before the tool is executed.

The resulting flow is:

```text
Nemotron
  ↓
AI SDK parsing
  ↓
structured tool arguments
  ↓
Zod validation
  ↓
tool execution
```

The application does not manually extract tool arguments from the raw provider response.

---

## 8. Agent State

The loop retains two primary forms of state.

### Conversation state

A chronological message collection contains the system instructions, investigation objective, assistant tool calls, and tool results.

This state is passed back to the model on subsequent iterations.

### Evidence state

Successful tool results are collected separately as investigation evidence.

Failed tool executions and validation failures remain visible in the operational trace and conversation context but are not treated as factual evidence.

---

## 9. Observable Trace

Each investigation produces an ordered collection of trace events.

Trace events contain operational information such as:

* index
* phase
* decision summary
* tool name
* tool input
* tool output
* error
* error type
* validation status
* execution duration

The trace is intended to answer:

> What did the agent execute, what happened, and in what order?

The implementation deliberately does not expose hidden chain-of-thought or private model reasoning.

Raw provider reasoning content and internal provider metadata are excluded from the trace.

---

## 10. Failure Handling

The agent handles multiple failure conditions deliberately.

### Tool execution failure

If a tool raises a `ToolExecutionError`, the runner catches the error and records it in the trace.

The error is also returned to the model as tool-result context, allowing the model to determine whether it can continue.

### Invalid arguments

If Zod validation fails, the tool is never executed.

The validation failure is recorded and returned to the model.

### Unknown tool

An unknown tool request is recorded as a validation failure and returned to the model as execution context.

### Execution limit

The loop is bounded by `maxSteps`.

Once the configured limit is reached, the loop exits without making another model or tool call.

The run is marked as `limit_reached`.

---

## 11. Evidence and Conclusion

The implementation distinguishes factual evidence from the agent's final assessment.

### Evidence

Only successful tool executions are added to the evidence collection.

Examples include information returned by:

* `search_logs`
* `get_metrics`
* `get_service_status`

Failed tool calls remain part of the operational trace but are not added as factual evidence.

### Conclusion

The final response is generated dynamically from the current investigation context and collected evidence.

The current structured response contains:

```text
rootCause
confidence
remediation
unknowns
```

This separates:

* **Evidence** — facts returned by the available tools.
* **Conclusion** — the agent's assessment based on the available evidence.
* **Remediation** — suggested actions.
* **Unknowns** — unresolved questions or missing information.

The conclusion represents an assessment of the available evidence and does not imply certainty beyond what the collected evidence supports.

---

## 12. Execution Limits

The agent loop uses a configurable `maxSteps` value.

The loop condition prevents execution from continuing indefinitely.

When the configured limit is reached:

1. The loop stops.
2. No additional model call is made.
3. No additional tool call is made.
4. The run status becomes `limit_reached`.
5. The trace contains the execution that occurred before termination.
6. No additional final synthesis call is performed.

This provides deterministic bounded execution.

---

## 13. Automated Testing

The automated tests use `FakeScriptedAdapter`.

This means the required tests do not depend on a paid or live model API.

The current test suite contains seven tests covering:

1. Multi-step tool usage and successful conclusion.
2. Exact execution-limit enforcement with no extra adapter call.
3. Validation failure and loop continuation.
4. Tool execution failure and loop continuation.
5. Unknown-tool handling.
6. Trace phases, indices, and decision summaries.
7. Evidence accumulation only from successful tool executions.

### Current test result

```text
7 tests
7 passed
0 failed
```

Command:

```bash
npm test
```

---

## 14. Acceptance Criteria

### AC1 — Appropriate tool selection

The model dynamically selects an available tool and provides structured arguments.

The tool name is validated through the `ToolRegistry` and arguments are validated with Zod before execution.

### AC2 — Multi-step investigation

Tool results are returned to the model and retained in conversation state.

The model can make subsequent tool decisions based on previously collected results.

### AC3 — Observable trace

The runner produces an ordered trace containing operational events such as decisions, tool calls, inputs, outputs, errors, validation state, and duration.

Private reasoning is not exposed.

### AC4 — Tool failure

Tool execution and validation failures are explicitly recorded and returned to the model as execution context.

The agent can therefore recover when possible or stop with a visible explanation.

### AC5 — Execution limit

`maxSteps` provides a hard execution boundary.

When the limit is reached, no additional model or tool call is made.

### AC6 — Evidence and conclusions

Successful tool results are accumulated as evidence and are kept distinct from the dynamically generated final conclusion.

---

## 15. Important Engineering Decisions

### Separate model and orchestration interfaces

The model is accessed through `ModelAdapter` rather than directly from the runner.

This allows production model interaction and deterministic testing to use the same agent-loop contract.

### Separate tool registry

Tools are registered through `ToolRegistry` rather than being hard-coded into the orchestration loop.

This allows the available tool set to be extended without rewriting the core loop.

### Validate before execution

Model-generated arguments are validated using Zod before any tool execution occurs.

This prevents malformed model output from being directly executed.

### Explicit execution bound

The agent does not rely on the model to decide when it should stop.

The orchestrator enforces `maxSteps`.

### Operational trace without hidden reasoning

The trace records observable execution information rather than exposing private model reasoning.

This provides useful debugging information while avoiding chain-of-thought exposure.

---

## 16. Assumptions and Limitations

* The project is designed for local execution as required by the exercise.
* Incident data is synthetic/mock data.
* The available tools represent a small incident-investigation environment.
* The project is not intended to provide production-grade monitoring or observability infrastructure.
* Durable distributed execution is not implemented.
* Human approval workflows are not implemented.
* Cloud deployment is not required for the exercise and is not part of the current implementation.

---

## 17. Remote Execution

The core agent behavior can be preserved when running remotely by keeping the model, tools, and orchestration interfaces independent of the execution environment.

A remote implementation could:

* persist conversation and evidence state
* persist trace and run status
* use a queue to distribute agent work
* execute bounded agent steps in workers
* expose the runner through an API
* replace the local model adapter with a remote model service

The core loop would remain:

```text
model decision
→ validate
→ execute tool
→ record result
→ update state
→ model decision
```

The execution environment would change, but the agent's control logic would remain the same.

---

## 18. Consequential Tools and Human Approval

A consequential tool could be represented with an approval requirement in its tool metadata.

The runner could detect that requirement before execution and transition the investigation into an `approval_required` state.

Execution would resume only after an authorized approval is received.

This is a proposed extension; human approval is not implemented in the current local version.

---

## 19. Concurrent Cloud Jobs

For concurrent remote investigations, execution state should not depend solely on process memory.

A production implementation could:

* persist run state in durable storage
* use a queue for job scheduling
* execute individual bounded steps in workers
* associate each job with a run identifier
* persist trace and evidence independently of worker lifetime

This would allow multiple investigations to execute concurrently while preserving the same core agent-loop behavior.

---

## 20. Run Data for Debugging, Cost Analysis, and Evaluation

A production implementation should persist the operational data required to reproduce and evaluate an investigation.

Useful run data includes:

* investigation objective
* run status
* execution duration
* execution steps
* model/tool decisions
* tool names
* validated tool inputs
* tool outputs
* errors
* evidence
* final response
* model usage/cost metadata where available

Secrets such as API keys, authorization headers, and environment variables should not be included in the trace.

---

## 21. Demo Coverage

The demo demonstrates the required Problem 4 behaviors:

1. Available tools and synthetic data.
2. A genuine investigation requiring multiple tool calls.
3. The ordered execution trace.
4. A deliberate tool failure and its handling.
5. Execution stopping at the configured limit.
6. The final response with collected evidence and conclusion.

The demo focuses on observable behavior rather than hidden model reasoning.

---

## 22. Verification

The current implementation has been verified with:

```text
npm test
```

Result:

```text
7 tests passed
```

The production build has also been verified with:

```text
npm run build
```

The build completes successfully.

The implementation was tested without modifying the model to compensate for tool-call parsing behavior. The AI SDK receives structured tool arguments through the configured tool schema, followed by application-level Zod validation before execution.

---

## 23. AI Assistance

AI tools were used during development as engineering assistants.

### Lovable AI

Lovable AI assisted with the frontend and user-interface implementation.

### Antigravity

Antigravity assisted with backend and agent-loop implementation, debugging, integration, and verification.

### ChatGPT

ChatGPT assisted with architecture and implementation planning, debugging analysis, prompt development, code review, and preparation of documentation and demo material.

### Candidate responsibility

I remained responsible for the overall solution, including:

* selecting the Problem 4 implementation approach
* integrating the frontend and backend
* making engineering decisions
* reviewing the generated implementation
* validating the model/tool boundary
* running and verifying the automated tests
* verifying the production build
* preparing the final submission
* demonstrating the implementation against the Problem 4 requirements

AI assistance was used as a development aid. The final implementation was reviewed and validated by the candidate before submission.
