import type { FinishReason } from "ai";

type StreamPart = { type: string; error?: unknown };

// streamText represents provider failures as stream parts. Consume the full
// stream and propagate those failures; finishReason also rejects on aborts.
export async function consumeModelStream(
  result: { stream: AsyncIterable<StreamPart>; finishReason: PromiseLike<FinishReason> },
  onPart?: (part: StreamPart) => Promise<void>,
): Promise<FinishReason> {
  for await (const part of result.stream) {
    if (part.type === "error") throw part.error;
    await onPart?.(part);
  }
  return await result.finishReason;
}
