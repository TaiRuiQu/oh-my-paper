import "server-only";
import { ToolLoopAgent, isStepCount, type ModelMessage } from "ai";
import type { Prisma } from "@/generated/prisma/client";
import type { AiKind } from "@/contracts/platform-ai";
import { createTaskFeatures } from "./features";
import { loadAiModel } from "./model";
import { RequestError } from "@/server/http/errors";
import { statelessResponsesMessages } from "./responses";
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
          { type: "text", text: "Visual evidence from the preceding inspect_image tool:" },
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
    const emit = options.onEvent ?? (async () => {});
    await emit({ type: "start", kind: options.kind, model: configuration.identity });
    const agent = new ToolLoopAgent({
      model: configuration.model,
      instructions: features.instructions,
      tools: features.tools,
      maxOutputTokens: configuration.maxOutputTokens,
      maxRetries: 2,
      providerOptions:
        configuration.identity.apiType === "openai_responses"
          ? { openai: { store: false } }
          : undefined,
      prepareStep:
        configuration.identity.apiType === "openai_chat"
          ? async ({ messages }) => ({ messages: chatToolImages(messages) })
          : configuration.identity.apiType === "openai_responses"
            ? async ({ messages }) => ({ messages: statelessResponsesMessages(messages) })
            : undefined,
      stopWhen: [isStepCount(2048), () => features.isComplete()],
      onToolExecutionStart: async (e) => {
        await emit({ type: "tool", name: e.toolCall.toolName, status: "started" });
      },
      onToolExecutionEnd: async (e) => {
        await emit({
          type: "tool",
          name: e.toolCall.toolName,
          status: "ended",
          durationMs: e.toolExecutionMs,
        });
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
    const remaining = (active.get(key) ?? 1) - 1;
    if (remaining) active.set(key, remaining);
    else active.delete(key);
  }
}
