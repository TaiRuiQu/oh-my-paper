import type { QuestionProgress } from "@/contracts/exam-tasks";
import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import {
  generateText,
  Output,
  ToolLoopAgent,
  isStepCount,
  type ToolSet,
  type UserContent,
} from "ai";
import { parsedExamSchema, type ParsedExam } from "@/contracts/exams";
import { providerSnapshotSchema, type ProviderSnapshot } from "@/contracts/ai-providers";
import { AppError } from "@/server/errors";
import { logError } from "@/server/logger";
import { redactErrorText } from "@/lib/error-message";
import type { AgentEventInput } from "@/contracts/activity";
import { providerConcurrencyLimiter } from "./concurrency";
import { expandToolImages } from "./tool-images";
import type { CreditMeter } from "./credits";
import { createResultTools } from "@/server/exams/result-tools";

const MAX_AGENT_STEPS = 256;

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
export function reasoningOptions(
  config: Pick<ProviderSnapshot, "apiType" | "reasoningEffort">,
): NonNullable<Parameters<typeof generateText>[0]["providerOptions"]> {
  const effort = config.reasoningEffort;
  switch (config.apiType) {
    case "openai_responses":
      return {
        openai: { store: false, ...(effort === "default" ? {} : { reasoningEffort: effort }) },
      };
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
  }
}
export function createProviderExamModel(
  raw: ProviderSnapshot,
  apiKey: string,
  fetch = globalThis.fetch,
  creditMeter?: CreditMeter,
): ExamModel & AgentModel {
  const config = providerSnapshotSchema.parse(raw);
  const common = {
    apiKey,
    baseURL: config.baseURL,
    fetch: ((input, init) => fetch(input, { ...init, redirect: "error" })) as typeof fetch,
  };
  const model =
    config.apiType === "openai_responses"
      ? createOpenAI(common).responses(config.model)
      : config.apiType === "openai_chat"
        ? createOpenAICompatible({
            ...common,
            name: "exam",
            supportsStructuredOutputs: config.structuredOutputs,
          })(config.model)
        : config.apiType === "anthropic"
          ? createAnthropic(common)(config.model)
          : createGoogle(common)(config.model);
  const run = (request: AgentRequest) =>
    providerConcurrencyLimiter(config.providerId).run(
      config.maxConcurrency,
      async () => {
        let step = 0;
        const emit = request.onEvent ?? (async () => {});
        const agent = new ToolLoopAgent({
          model,
          onLanguageModelCallStart: async () => creditMeter?.beforeCall(),
          onLanguageModelCallEnd: async ({ callId, usage }) =>
            creditMeter?.record(`${callId}:${step}`, usage),
          instructions: request.system,
          tools: request.tools,
          toolChoice: "required",
          ...(config.apiType === "openai_chat"
            ? { prepareStep: ({ messages }) => ({ messages: expandToolImages(messages) }) }
            : {}),
          stopWhen: [isStepCount(MAX_AGENT_STEPS), request.isComplete],
          timeout: { stepMs: config.timeoutSeconds * 1000 },
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
        await agent.generate({
          messages: [{ role: "user", content: request.content }],
          abortSignal: request.signal,
        });
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
    generate: async (request) => {
      if (request.tools) {
        const result = createResultTools(request.onProgress, request.onQuestionProgress);
        await run({
          ...request,
          system:
            request.system +
            "\nFirst scan all pages and call report_question_count. Save recognized questions promptly with append_questions. Batch independent tool calls in one response: save completed questions while reading or zooming the next. Never wait for a whole section. Rotate pages before saving material coordinates. Submit only after saving the reported total.",
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
          const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
          const result = await generateText({
            model,
            onLanguageModelCallStart: async () => creditMeter?.beforeCall(),
            onLanguageModelCallEnd: async ({ callId, usage }) => creditMeter?.record(callId, usage),
            system:
              request.system +
              (!config.structuredOutputs
                ? `\nRequired JSON schema: ${JSON.stringify(parsedExamSchema.toJSONSchema())}`
                : ""),
            messages: [{ role: "user", content: request.content }],
            output: Output.object({ schema: parsedExamSchema, name: "exam" }),
            maxOutputTokens: config.maxOutputTokens,
            providerOptions: reasoningOptions(config),
            maxRetries: 1,
            abortSignal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
          });
          if (result.finishReason !== "stop")
            throw new AppError(
              `AI 返回内容不完整（结束原因：${result.finishReason}），请检查输出 token 上限。`,
              "AI_OUTPUT_INCOMPLETE",
              422,
            );
          return parsedExamSchema.parse(result.output);
        },
        request.signal,
      );
    },
  };
}
