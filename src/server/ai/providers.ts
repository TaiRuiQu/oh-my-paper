import type { QuestionProgress } from "@/contracts/exam-tasks";
import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { streamText, ToolLoopAgent, isStepCount, type ToolSet, type UserContent } from "ai";
import { parsedExamSchema, type ParsedExam } from "@/contracts/exams";
import { providerSnapshotSchema, type ProviderSnapshot } from "@/contracts/ai-providers";
import { AppError } from "@/server/errors";
import { logError } from "@/server/logger";
import { redactErrorText } from "@/lib/error-message";
import type { AgentEventInput, AgentTimingRequest } from "@/contracts/activity";
import { providerConcurrencyLimiter } from "./concurrency";
import { expandToolImages } from "./tool-images";
import { compatibleResponsesResponse, prepareResponsesMessages } from "./responses-compat";
import type { CreditMeter } from "./credits";
import { createResultTools } from "@/server/exams/result-tools";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { consumeModelStream } from "./streams";

const MAX_AGENT_STEPS = 256;

// The SDK appends /messages, but only adds /v1 for api.anthropic.com.
// Compatible gateways commonly give users an unversioned API root instead.
export function anthropicBaseURL(baseURL: string) {
  const root = baseURL.replace(/\/+$/, "").replace(/\/messages$/, "");
  return /\/v\d+$/.test(root) ? root : `${root}/v1`;
}

// 不依赖结构化输出模式：模型按提示词返回 JSON 文本，这里容错提取后交给 zod 校验。
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text),
    candidate = (fenced ? fenced[1] : text).trim(),
    start = candidate.indexOf("{"),
    end = candidate.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate);
}

export interface AgentRequest {
  system: string;
  content: UserContent;
  tools: ToolSet;
  isComplete: () => boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentEventInput) => Promise<void>;
}
export interface AgentModel {
  run(request: AgentRequest): Promise<void>;
}
export interface ExamModel {
  generate(request: {
    system: string;
    content: UserContent;
    signal?: AbortSignal;
    tools?: ToolSet;
    onEvent?: (event: AgentEventInput) => Promise<void>;
    onProgress?: (exam: ParsedExam) => Promise<void>;
    onQuestionProgress?: (progress: QuestionProgress) => Promise<void>;
  }): Promise<ParsedExam>;
}
export interface SingleCallModel {
  generateJson<T>(request: {
    system: string;
    content: UserContent;
    schema: z.ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T>;
}
export function reasoningOptions(
  config: Pick<ProviderSnapshot, "apiType" | "reasoningEffort" | "baseURL">,
): NonNullable<Parameters<typeof streamText>[0]["providerOptions"]> {
  const effort = config.reasoningEffort;
  switch (config.apiType) {
    case "openai_responses": {
      const compatibleGateway = new URL(config.baseURL).hostname !== "api.openai.com";
      return {
        openai: {
          store: true,
          ...(effort === "default"
            ? {}
            : {
                reasoningEffort: effort,
                // A gateway's administrator declares the model's supported efforts.
                // The SDK's OpenAI model-name allowlist cannot identify these models.
                ...(compatibleGateway
                  ? { forceReasoning: true, systemMessageMode: "system", reasoningSummary: null }
                  : {}),
              }),
        },
      };
    }
    case "openai_chat":
      return effort === "default" ? {} : { exam: { reasoningEffort: effort } };
    case "anthropic":
      return effort === "default"
        ? {}
        : {
            anthropic:
              effort === "none"
                ? { thinking: { type: "disabled" } }
                : { thinking: { type: "adaptive" }, effort },
          };
    case "google":
      return effort === "default"
        ? {}
        : {
            google: {
              thinkingConfig: effort === "none" ? { thinkingBudget: 0 } : { thinkingLevel: effort },
            },
          };
    case "google_interactions":
      return {
        google: { store: true, ...(effort === "default" ? {} : { thinkingLevel: effort }) },
      };
  }
}
export function createProviderExamModel(
  raw: ProviderSnapshot,
  apiKey: string,
  fetch = globalThis.fetch,
  creditMeter?: CreditMeter,
): ExamModel & AgentModel & SingleCallModel {
  const config = providerSnapshotSchema.parse(raw);
  const streamTimeout = {
    firstChunkMs: config.timeoutSeconds * 1000,
    chunkMs: config.timeoutSeconds * 1000,
  };
  // 逐个 HTTP 请求计时（等待响应头、接收响应体），供管理员活动面板按轮展示耗时。
  const requestTimings: AgentTimingRequest[] = [];
  const timedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const record: AgentTimingRequest = { ttfbMs: 0, bodyMs: 0, status: 0, failed: false };
    requestTimings.push(record);
    const headersAbort = new AbortController();
    const timer = setTimeout(() => {
      headersAbort.abort(new DOMException("等待 AI 接口响应头超时。", "TimeoutError"));
    }, config.timeoutSeconds * 1000);
    try {
      const response = await fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, headersAbort.signal])
          : headersAbort.signal,
        redirect: "error",
      });
      clearTimeout(timer);
      record.ttfbMs = Math.round(performance.now() - started);
      record.status = response.status;
      if (response.body) {
        const timedResponse = new Response(
          response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                controller.enqueue(chunk);
                record.bodyMs = Math.round(performance.now() - started - record.ttfbMs);
              },
            }),
          ),
          response,
        );
        return config.apiType === "openai_responses"
          ? await compatibleResponsesResponse(timedResponse, true)
          : timedResponse;
      }
      return response;
    } catch (error) {
      record.ttfbMs = Math.round(performance.now() - started);
      record.failed = true;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
  const common = { apiKey, baseURL: config.baseURL, fetch: timedFetch };
  const model =
    config.apiType === "openai_responses"
      ? createOpenAI(common).responses(config.model)
      : config.apiType === "openai_chat"
        ? createOpenAICompatible({ ...common, name: "exam", includeUsage: true })(config.model)
        : config.apiType === "anthropic"
          ? createAnthropic({ ...common, baseURL: anthropicBaseURL(config.baseURL) })(config.model)
          : config.apiType === "google_interactions"
            ? createGoogle(common).interactions(config.model)
            : createGoogle(common)(config.model);
  const run = (request: AgentRequest) =>
    providerConcurrencyLimiter(config.providerId).run(
      config.maxConcurrency,
      async () => {
        let step = 0;
        let billingError: unknown;
        const billingAbort = new AbortController();
        const emit = request.onEvent ?? (async () => {});
        const agent = new ToolLoopAgent({
          model,
          onLanguageModelCallStart: async () => {
            requestTimings.length = 0;
            try {
              await creditMeter?.beforeCall();
            } catch (error) {
              billingError = error;
              billingAbort.abort(error);
            }
          },
          onLanguageModelCallEnd: async ({ callId, usage, performance: timings }) => {
            try {
              await creditMeter?.record(`${callId}:${step}`, usage);
            } catch (error) {
              billingError = error;
              billingAbort.abort(error);
            }
            await emit({
              type: "timing",
              step,
              durationMs: Math.round(timings.responseTimeMs),
              data: {
                requests: requestTimings.splice(0),
                inputTokens: usage.inputTokens ?? 0,
                outputTokens: usage.outputTokens ?? 0,
                outputTokensPerSecond: Math.round(timings.effectiveOutputTokensPerSecond),
              },
            });
          },
          instructions: request.system,
          tools: request.tools,
          // 部分 OpenAI 兼容接口在思考模式下拒绝强制 tool_choice，工具调用改由提示词约束。
          ...(config.apiType === "openai_chat"
            ? { prepareStep: ({ messages }) => ({ messages: expandToolImages(messages) }) }
            : config.apiType === "openai_responses"
              ? {
                  prepareStep: ({ messages }) => ({
                    messages: prepareResponsesMessages(messages, { store: true }),
                  }),
                }
              : {}),
          stopWhen: [isStepCount(MAX_AGENT_STEPS), request.isComplete],
          timeout: streamTimeout,
          maxOutputTokens: config.maxOutputTokens,
          maxRetries: 1,
          providerOptions: reasoningOptions(config),
          onStepStart: async () => {
            await emit({ type: "step", step: ++step, text: `模型调用 ${step}` });
          },
          onToolExecutionStart: async ({ toolCall }) => {
            await emit({
              type: "tool_call",
              step,
              callId: toolCall.toolCallId,
              tool: toolCall.toolName,
              data: JSON.parse(JSON.stringify(toolCall.input).replaceAll(apiKey, "[redacted]")),
            });
          },
          onToolExecutionEnd: async ({ toolCall, toolOutput, toolExecutionMs }) => {
            const success = toolOutput.type === "tool-result";
            const failure = success
              ? undefined
              : logError(
                  "agent.tool.failed",
                  toolOutput.error,
                  {
                    providerId: config.providerId,
                    model: config.model,
                    tool: toolCall.toolName,
                    step,
                  },
                  { secrets: [apiKey] },
                );
            await emit({
              type: success ? "tool_result" : "tool_error",
              step,
              callId: toolCall.toolCallId,
              tool: toolCall.toolName,
              durationMs: toolExecutionMs,
              data: success ? toolOutput.output : failure,
            });
          },
          onStepEnd: async ({ text, toolCalls }) => {
            // Invalid arguments can fail before tool execution callbacks run.
            for (const call of toolCalls) {
              if (call.invalid) {
                const failure = logError(
                  "agent.tool.arguments.invalid",
                  call.error,
                  { providerId: config.providerId, tool: call.toolName, step },
                  { secrets: [apiKey] },
                );
                await emit({
                  type: "tool_call",
                  step,
                  callId: call.toolCallId,
                  tool: call.toolName,
                });
                await emit({
                  type: "tool_error",
                  step,
                  callId: call.toolCallId,
                  tool: call.toolName,
                  data: failure,
                });
              }
            }
            if (text) await emit({ type: "message", step, text: redactErrorText(text, [apiKey]) });
          },
        });
        try {
          const result = await agent.stream({
            messages: [{ role: "user", content: request.content }],
            abortSignal: request.signal
              ? AbortSignal.any([request.signal, billingAbort.signal])
              : billingAbort.signal,
          });
          let outputStep = 0;
          await consumeModelStream(result, async (part) => {
            if (
              outputStep !== step &&
              ["text-delta", "reasoning-delta", "tool-input-delta"].includes(part.type)
            ) {
              outputStep = step;
              await emit({ type: "message", step, text: "模型开始流式输出。" });
            }
          });
        } catch (error) {
          throw billingError ?? error;
        }
        if (billingError) throw billingError;
        if (!request.isComplete())
          throw new AppError(
            `模型达到 ${MAX_AGENT_STEPS} 次调用上限或提前结束，任务尚未完成；已保存的结果保留。`,
            "AGENT_INCOMPLETE",
            422,
          );
      },
      request.signal,
    );
  return {
    run,
    generateJson: (request) =>
      providerConcurrencyLimiter(config.providerId).run(
        config.maxConcurrency,
        async () => {
          // SDK lifecycle notifications swallow callback errors. Billing must be awaited directly.
          await creditMeter?.beforeCall();
          const result = streamText({
            model,
            system: request.system,
            messages: [
              {
                role: "user",
                content: [
                  ...(typeof request.content === "string"
                    ? [{ type: "text" as const, text: request.content }]
                    : request.content),
                  {
                    type: "text" as const,
                    text: `Return only JSON matching: ${JSON.stringify(request.schema.toJSONSchema())}`,
                  },
                ],
              },
            ],
            maxOutputTokens: config.maxOutputTokens,
            providerOptions: reasoningOptions(config),
            // Each question makes exactly one API call. Failed questions may be retried explicitly.
            maxRetries: 0,
            timeout: streamTimeout,
            abortSignal: request.signal,
          });
          const finishReason = await consumeModelStream(result);
          try {
            await creditMeter?.record(randomUUID(), await result.usage);
          } catch (cause) {
            throw new AppError("用量结算失败，已停止后续评分。", "CREDIT_SETTLEMENT_FAILED", 503, {
              cause,
            });
          }
          if (finishReason !== "stop")
            throw new AppError("评分响应未完整结束，请重试该题。", "AI_OUTPUT_INCOMPLETE", 422);
          return request.schema.parse(extractJson(await result.text));
        },
        request.signal,
      ),
    generate: async (request) => {
      if (request.tools) {
        const result = createResultTools(request.onProgress, request.onQuestionProgress);
        await run({
          ...request,
          tools: { ...request.tools, ...result.tools },
          isComplete: result.isComplete,
        });
        const saved = result.result();
        if (!result.isComplete() || !saved)
          throw new AppError(
            `模型达到 ${MAX_AGENT_STEPS} 次调用上限或提前结束，尚未完成整卷识别；已追加的题目保留在草稿中。`,
            "AGENT_INCOMPLETE",
            422,
          );
        return saved;
      }
      return providerConcurrencyLimiter(config.providerId).run(
        config.maxConcurrency,
        async () => {
          requestTimings.length = 0;
          await creditMeter?.beforeCall();
          const result = streamText({
            model,
            system: request.system,
            messages: [
              {
                role: "user",
                content: [
                  ...(typeof request.content === "string"
                    ? [{ type: "text" as const, text: request.content }]
                    : request.content),
                  {
                    type: "text" as const,
                    text: `Return only JSON matching: ${JSON.stringify(parsedExamSchema.toJSONSchema())}`,
                  },
                ],
              },
            ],
            maxOutputTokens: config.maxOutputTokens,
            providerOptions: reasoningOptions(config),
            maxRetries: 1,
            timeout: streamTimeout,
            abortSignal: request.signal,
          });
          const finishReason = await consumeModelStream(result);
          await creditMeter?.record(randomUUID(), await result.usage);
          if (finishReason !== "stop")
            throw new AppError(
              `AI 返回内容不完整（结束原因：${finishReason}），请检查输出 token 上限。`,
              "AI_OUTPUT_INCOMPLETE",
              422,
            );
          return parsedExamSchema.parse(extractJson(await result.text));
        },
        request.signal,
      );
    },
  };
}
