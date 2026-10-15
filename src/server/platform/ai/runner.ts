import "server-only";
import { ToolLoopAgent, isStepCount, type ModelMessage } from "ai";
import type { Prisma } from "@/generated/prisma/client";
import type { AiKind } from "@/contracts/platform-ai";
import { createTaskFeatures } from "./features";
import { loadAiModel } from "./model";
import { RequestError } from "@/server/http/errors";
import { statelessResponsesMessages } from "./responses";
import { toolErrorDetails } from "./tools";
export type AiTaskOptions = {
  userId: string;
  kind: AiKind;
  input: unknown;
  modelId?: string;
  jobId?: string;
  onEvent?: (event: Prisma.JsonValue) => Promise<void>;
};
/** Chat-completions tool outputs are text-only; move tool images into real user image parts. */
export function chatToolImages(messages: ModelMessage[]): ModelMessage[] {
  const output: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      output.push(message);
      continue;
    }
    const images: {
      type: "file";
      mediaType: string;
      data: { type: "data"; data: string | Uint8Array | ArrayBuffer };
    }[] = [];
    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") return part;
      const retained = part.output.value.filter((value) => {
        if (
          value.type === "file" &&
          value.mediaType.startsWith("image/") &&
          value.data.type === "data"
        ) {
          images.push({ type: "file", mediaType: value.mediaType, data: value.data });
          return false;
        }
        return true;
      });
      return { ...part, output: { type: "content" as const, value: retained } };
    });
    output.push({ ...message, content });
    if (images.length)
      output.push({
        role: "user",
        content: [
          { type: "text", text: "Visual evidence from the preceding sandbox tool:" },
          ...images,
        ],
      });
  }
  return output;
}
const active = new Map<string, number>();
export async function runAiTask(
  options: AiTaskOptions,
): Promise<{ summary: string; result: Prisma.JsonValue }> {
  const configuration = await loadAiModel(options.userId, options.modelId);
  const key = configuration.identity.providerId;
  const count = active.get(key) ?? 0;
  if (count >= configuration.maxConcurrency)
    throw new RequestError(429, "该模型供应商已达到并发上限，请稍后重试。");
  active.set(key, count + 1);
  try {
    const features = await createTaskFeatures(options);
    try {
      const emit = options.onEvent ?? (async () => {});
      await emit({ type: "start", kind: options.kind, model: configuration.identity });
      const agent = new ToolLoopAgent({
        model: configuration.model,
        instructions: features.instructions,
        tools: features.tools,
        maxOutputTokens: configuration.maxOutputTokens,
        maxRetries: 2,
        providerOptions: ["openai_chat", "openai_responses"].includes(
          configuration.identity.apiType,
        )
          ? {
              openai: {
                parallelToolCalls: true,
                ...(configuration.identity.apiType === "openai_responses" ? { store: false } : {}),
              },
            }
          : undefined,
        repairToolCall: async ({ toolCall, error }) => {
          // Let the same agent correct the call on its next turn; do not spend a separate model call.
          await emit({
            type: "tool",
            name: toolCall.toolName,
            status: "ended",
            toolCallId: toolCall.toolCallId,
            input: toolCall.input,
            error: JSON.stringify(toolErrorDetails(error)),
          });
          return null;
        },
        prepareStep:
          configuration.identity.apiType === "openai_chat"
            ? async ({ messages }) => ({ messages: chatToolImages(messages) })
            : configuration.identity.apiType === "openai_responses"
              ? async ({ messages }) => ({ messages: statelessResponsesMessages(messages) })
              : undefined,
        stopWhen: [isStepCount(2048), () => features.isComplete()],
        onToolExecutionStart: async (e) => {
          await emit(
            JSON.parse(
              JSON.stringify({
                type: "tool",
                name: e.toolCall.toolName,
                status: "started",
                toolCallId: e.toolCall.toolCallId,
                input: e.toolCall.input,
              }),
            ),
          );
        },
        onToolExecutionEnd: async (e) => {
          await emit({
            type: "tool",
            name: e.toolCall.toolName,
            status: "ended",
            durationMs: e.toolExecutionMs,
            toolCallId: e.toolCall.toolCallId,
            ...(e.toolOutput.type === "tool-error"
              ? { error: JSON.stringify(toolErrorDetails(e.toolOutput.error)) }
              : {}),
          });
          if (e.toolOutput.type === "tool-result") {
            const output = e.toolOutput.output as {
              results?: { index: number; success: boolean; error?: unknown }[];
            } | null;
            const failures = output?.results?.filter((entry) => !entry.success);
            if (failures?.length)
              await emit({
                type: "tool",
                name: e.toolCall.toolName,
                status: "ended",
                toolCallId: e.toolCall.toolCallId,
                error: JSON.stringify(failures),
              });
          }
          if (
            ["python", "shell"].includes(e.toolCall.toolName) &&
            e.toolOutput.type === "tool-result"
          ) {
            const output = e.toolOutput.output as {
              exitCode: number;
              stdout: string;
              stderr: string;
              images: { name: string; url?: string }[];
            };
            await emit(
              JSON.parse(
                JSON.stringify({
                  type: "sandbox",
                  name: e.toolCall.toolName,
                  toolCallId: e.toolCall.toolCallId,
                  exitCode: output.exitCode,
                  stdout: output.stdout,
                  stderr: output.stderr,
                  images: output.images.map((image) => ({ name: image.name, url: image.url })),
                }),
              ),
            );
          }
        },
        onStepEnd: async (e) => {
          await emit(
            JSON.parse(
              JSON.stringify({
                type: "step",
                finishReason: e.finishReason,
                toolNames: e.toolCalls.map((t) => t.toolName),
                usage: e.usage,
              }),
            ),
          );
        },
      });
      await agent.generate({
        prompt: features.prompt,
        // Provider timeout bounds each step; full tasks may include hundreds of questions.
        timeout: { totalMs: 60 * 60 * 1000, stepMs: Math.max(configuration.timeoutMs, 1000) },
      });
      if (!features.isComplete())
        throw new RequestError(422, "AI未完成全部要求，请查看任务说明后重试。");
      const output = await features.commit();
      await emit({ type: "complete", summary: output.summary });
      return output;
    } finally {
      await features.dispose();
    }
  } finally {
    const remaining = (active.get(key) ?? 1) - 1;
    if (remaining) active.set(key, remaining);
    else active.delete(key);
  }
}
