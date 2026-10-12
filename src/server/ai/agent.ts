import "server-only";
import {
  isStepCount,
  ToolLoopAgent,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from "ai";
import type { AgentEventInput } from "@/contracts/recognition";
import type { ExamModelUsage } from "./deepseek";

export type RecognitionAgentRequest = {
  instructions: string;
  content: UserContent;
  tools: ToolSet;
  signal?: AbortSignal;
  isComplete: () => boolean;
  onEvent: (event: AgentEventInput) => Promise<void>;
  maxSteps?: number;
};
export function recognitionRunner(
  model: LanguageModel,
  settings: {
    timeoutMs: number;
    maxOutputTokens: number;
    providerOptions?: ConstructorParameters<typeof ToolLoopAgent>[0]["providerOptions"];
  },
) {
  return async (request: RecognitionAgentRequest): Promise<ExamModelUsage> => {
    const usage: ExamModelUsage = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    };
    let step = 0;
    let checkpointMessages: ModelMessage[] = [{ role: "user", content: request.content }];
    const agent = new ToolLoopAgent({
      model,
      instructions: request.instructions,
      tools: request.tools,
      // Completion is a validated tool result; the model still chooses every tool and its order.
      toolChoice: "required",
      maxOutputTokens: settings.maxOutputTokens,
      maxRetries: 2,
      timeout: { stepMs: settings.timeoutMs },
      providerOptions: settings.providerOptions,
      // The SDK owns the loop. There is no prescribed tool order or per-question model call.
      stopWhen: [
        isStepCount(request.maxSteps ?? 100),
        () => request.isComplete() || usage.calls >= (request.maxSteps ?? 100),
      ],
      prepareStep: ({ messages }) => {
        const visualIndices = messages.flatMap((message, index) =>
          message.role === "tool" &&
          message.content.some(
            (part) =>
              part.type === "tool-result" &&
              part.output.type === "content" &&
              part.output.value.some((p) => p.type === "file"),
          )
            ? [index]
            : [],
        );
        const recentVisual = new Set(visualIndices.slice(-4));
        checkpointMessages = messages.map((message, index) => {
          if (message.role !== "tool" || recentVisual.has(index)) return message;
          return {
            ...message,
            content: message.content.map((part) => {
              if (
                part.type !== "tool-result" ||
                part.output.type !== "content" ||
                !part.output.value.some((p) => p.type === "file")
              )
                return part;
              return {
                ...part,
                output: {
                  type: "content" as const,
                  value: [
                    ...part.output.value.filter((p) => p.type !== "file"),
                    {
                      type: "text" as const,
                      text: "Earlier image pixels expired from active context. Use read_pages, inspect_image or review_questions to view source evidence again when needed. Saved results and source coordinates remain available.",
                    },
                  ],
                },
              };
            }),
          };
        });
        return { messages: checkpointMessages };
      },
      onStepStart: async () => {
        step = ++usage.calls;
        await request.onEvent({ type: "step", step });
      },
      onToolExecutionStart: async ({ toolCall }) => {
        await request.onEvent({
          type: "tool_call",
          step,
          callId: toolCall.toolCallId,
          tool: toolCall.toolName,
          data: toolCall.input,
        });
      },
      onToolExecutionEnd: async ({ toolCall, toolOutput, toolExecutionMs }) => {
        await request.onEvent({
          type: toolOutput.type === "tool-result" ? "tool_result" : "tool_error",
          step,
          callId: toolCall.toolCallId,
          tool: toolCall.toolName,
          durationMs: toolExecutionMs,
          data:
            toolOutput.type === "tool-result"
              ? toolOutput.output
              : { error: "工具执行失败；请检查输入后重试。" },
        });
      },
      onStepEnd: async ({ usage: value, text, response }) => {
        checkpointMessages = [...checkpointMessages, ...response.messages];
        if (text) await request.onEvent({ type: "message", step, text });
        usage.inputTokens += value.inputTokens ?? 0;
        usage.outputTokens += value.outputTokens ?? 0;
        usage.cachedInputTokens += value.inputTokenDetails?.cacheReadTokens ?? 0;
        usage.cacheWriteTokens += value.inputTokenDetails?.cacheWriteTokens ?? 0;
      },
    });
    try {
      await agent.generate({
        messages: [{ role: "user", content: request.content }],
        abortSignal: request.signal,
      });
      if (!request.isComplete())
        throw new Error("Recognition agent stopped without a validated submission.");
      return usage;
    } catch (cause) {
      const failure =
        cause && typeof cause === "object"
          ? (cause as { isRetryable?: boolean; lastError?: { isRetryable?: boolean } })
          : {};
      if (
        (failure.isRetryable || failure.lastError?.isRetryable) &&
        !request.signal?.aborted &&
        usage.calls < (request.maxSteps ?? 100)
      ) {
        await request.onEvent({
          type: "message",
          text: "模型连接暂时不可用，正在从已完成的工具操作继续。",
        });
        try {
          // Transport recovery keeps the exact completed tool conversation;
          // the SDK still controls every subsequent tool decision and iteration.
          await agent.generate({ messages: checkpointMessages, abortSignal: request.signal });
          if (request.isComplete()) return usage;
        } catch {
          /* Fail with safe metadata and preserve checkpoints after this bounded recovery. */
        }
      }
      // Never expose exception messages, request bodies or credentials.
      const record =
        cause && typeof cause === "object"
          ? (cause as { name?: string; lastError?: unknown; statusCode?: number })
          : {};
      const last =
        record.lastError && typeof record.lastError === "object"
          ? (record.lastError as { name?: string; statusCode?: number; cause?: { code?: string } })
          : (record as { name?: string; statusCode?: number; cause?: { code?: string } });
      await request.onEvent({
        type: "message",
        text: "模型请求未完成，已保存的识别内容与操作记录仍保留。",
        data: {
          errorType: last.name?.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80),
          statusCode: last.statusCode,
          code: last.cause?.code?.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80),
        },
      });
      const { ExamModelCallError } = await import("./deepseek");
      throw new ExamModelCallError(cause, usage);
    }
  };
}
