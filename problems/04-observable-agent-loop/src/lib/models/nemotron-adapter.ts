import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, tool, jsonSchema, type ModelMessage } from "ai";
import { z } from "zod";
import type { ModelAdapter } from "../agent/model-adapter";
import type {
  ConversationMessage,
  ModelRequest,
  ModelResponse,
  ToolCallRecord,
} from "../agent/types";
import type { ToolSpec } from "../tools/types";
import { createDefaultRegistry } from "../tools/registry";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * NemotronAdapter — the production ModelAdapter backed by NVIDIA NIM.
 *
 * Architecture decisions:
 *   - Uses @ai-sdk/openai-compatible (already a project dependency) to talk to
 *     the NVIDIA NIM OpenAI-compatible endpoint.
 *   - Tools are passed WITHOUT an `execute` handler so the AI SDK never
 *     auto-executes them. Tool calls are returned in result.toolCalls for the
 *     runner to validate and execute through the ToolRegistry.
 *   - decisionSummary is built from the tool call's name and arguments —
 *     never from the model's text output (which could be chain-of-thought).
 *   - If the model returns both text AND tool calls in a single response,
 *     the tool call takes priority. The text is silently discarded to prevent
 *     chain-of-thought leakage into the trace.
 *
 * Configuration (environment variables):
 *   NVIDIA_API_KEY      — required; your NVIDIA NIM API key.
 *   NEMOTRON_MODEL_ID   — optional; defaults to nvidia/llama-3.1-nemotron-70b-instruct.
 *
 * @see https://build.nvidia.com/explore/reasoning
 */
export class NemotronAdapter implements ModelAdapter {
  readonly name: string;

  private readonly modelFn: ReturnType<ReturnType<typeof createOpenAICompatible>>;

  constructor(apiKey: string, modelId: string) {
    this.name = modelId;

    const provider = createOpenAICompatible({
      name: "nvidia-nim",
      baseURL: "https://integrate.api.nvidia.com/v1",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    this.modelFn = provider(modelId);
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    // Build AI-SDK-compatible tool map from ToolSpec list.
    // We intentionally omit `execute` so the SDK never auto-executes;
    // all execution happens through the runner → ToolRegistry path.
    const sdkTools = buildSdkTools(req.tools);

    // Convert our ConversationMessage[] to AI SDK ModelMessage[].
    const sdkMessages = toAiSdkMessages(req.messages);

    const result = await generateText({
      model: this.modelFn,
      system: req.systemPrompt,
      messages: sdkMessages,
      tools: sdkTools,
      toolChoice: "auto",
      maxTokens: 1024,
      temperature: 0.1, // Low temperature for consistent, grounded responses.
    });

    // If the model made tool call(s), return the first one.
    const firstCall = result.toolCalls?.[0];
    if (firstCall) {
      // Note: Vercel AI SDK newer versions use .args for generateText, 
      // wait no, Vercel AI SDK toolCall type uses .args in some versions and .input in others!
      // I will check for both just in case.
      const rawArgs = (firstCall as any).args || (firstCall as any).input || {};
      const safeArgs = (rawArgs as Record<string, unknown>) || {};
      const call: ToolCallRecord = {
        toolCallId: firstCall.toolCallId,
        toolName: firstCall.toolName,
        args: safeArgs,
      };
      return {
        kind: "tool_call",
        toolCall: call,
        decisionSummary: buildToolSummary(firstCall.toolName, safeArgs),
      };
    }

    // No tool calls — model produced a final text response.
    return {
      kind: "final_text",
      text: result.text ?? "",
      decisionSummary: "Agent produced final response.",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------


/**
 * Converts ToolSpec[] to the format expected by generateText()'s tools option.
 */
function buildSdkTools(specs: ToolSpec[]): Record<string, ReturnType<typeof tool>> {
  const result: Record<string, ReturnType<typeof tool>> = {};
  for (const spec of specs) {
    result[spec.name] = tool({
      description: spec.description,
      inputSchema: spec.schema,
    } as any);
  }
  return result;
}

/**
 * Converts our ConversationMessage[] to AI SDK ModelMessage[].
 * Handles all three roles: user, assistant (with optional tool-call part), tool.
 */
function toAiSdkMessages(messages: ConversationMessage[]): ModelMessage[] {
  return messages.map((msg): ModelMessage => {
    if (msg.role === "user") {
      return { role: "user", content: msg.content };
    }

    if (msg.role === "assistant") {
      type TextPart = { type: "text"; text: string };
      type ToolCallPart = {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      };
      const parts: Array<TextPart | ToolCallPart> = [];

      if (msg.content) {
        parts.push({ type: "text", text: msg.content });
      }

      if (msg.toolCall) {
        parts.push({
          type: "tool-call",
          toolCallId: msg.toolCall.toolCallId,
          toolName: msg.toolCall.toolName,
          input: msg.toolCall.args,
        });
      }

      // If there are no parts (unlikely), add an empty text to keep the SDK happy.
      if (parts.length === 0) {
        parts.push({ type: "text", text: "" });
      }

      return { role: "assistant", content: parts };
    }

    // role === "tool"
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          output: { type: "json", value: msg.result as never },
        },
      ],
    };
  });
}

/** Builds a human-readable summary from tool name + args for the trace. */
function buildToolSummary(toolName: string, args: Record<string, unknown> | undefined | null): string {
  const safeArgs = args || {};
  const argStr = Object.entries(safeArgs)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return `${toolName}(${argStr})`;
}
