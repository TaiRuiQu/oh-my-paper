import type { ConversationView } from "@earendil-works/pi-durable";
import type { Message } from "@earendil-works/pi-ai";
import type { XiaozhiPart, XiaozhiView } from "@/contracts/xiaozhi";
import { xiaozhiMessageSchema } from "@/contracts/xiaozhi";

export const emptyXiaozhiView = (): XiaozhiView => ({
  messages: [],
  busy: false,
  compacting: false,
  retrying: false,
});
export function projectXiaozhiView(
  view: ConversationView,
  previous = emptyXiaozhiView(),
): XiaozhiView {
  const messages = new Map(
    previous.messages
      .filter((message) => message.id !== "streaming")
      .map((message) => [message.id, message]),
  );
  // The committed transcript contains no client-authored assistant or tool messages.
  const process = (id: string, model: Message, original?: unknown) => {
    if (model.role === "system") return;
    if (model.role === "user" && original !== undefined) {
      const message = xiaozhiMessageSchema.parse(original);
      messages.set(message.id, {
        id: message.id,
        role: "user",
        parts: message.parts.map((part) =>
          part.type === "text"
            ? part
            : {
                type: "file",
                url: part.url,
                name: part.filename,
                mediaType: part.mediaType,
              },
        ),
      });
      return;
    }
    if (model.role === "toolResult") {
      for (const [key, message] of messages) {
        if (!message.parts.some((part) => part.type === "tool" && part.id === model.toolCallId))
          continue;
        messages.set(key, {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "tool" && part.id === model.toolCallId
              ? {
                  ...part,
                  output: model.content
                    .filter((content) => content.type === "text")
                    .map((content) => content.text)
                    .join("\n"),
                  state: model.isError ? "failed" : "completed",
                }
              : part,
          ),
        });
      }
      return;
    }
    const parts: XiaozhiPart[] =
      typeof model.content === "string"
        ? [{ type: "text", text: model.content }]
        : model.content.flatMap((part): XiaozhiPart[] => {
            if (part.type === "text") return [{ type: "text", text: part.text }];
            if (part.type === "thinking") return [{ type: "thinking", text: part.thinking }];
            if (part.type === "toolCall")
              return [
                {
                  type: "tool",
                  id: part.id,
                  name: part.name,
                  input: part.arguments,
                  state: "running",
                },
              ];
            return [];
          });
    if (parts.length) messages.set(id, { id, role: model.role, parts });
  };
  for (const entry of view.entries) {
    if (entry.kind === "pi.compaction" || entry.kind === "pi.reset") continue;
    const data = entry.data as { messageId?: string; message?: unknown } | undefined;
    for (const model of entry.model ?? [])
      process(data?.messageId ?? String(entry.id), model as Message, data?.message);
  }
  const live = view.docs["pi.live"] as
    | {
        run?: unknown;
        generation?: { message?: Message; retry?: unknown };
        compactions?: unknown[];
      }
    | undefined;
  if (live?.generation?.message) process("streaming", live.generation.message);
  else messages.delete("streaming");
  return {
    messages: [...messages.values()],
    busy: !!live?.run,
    compacting: !!live?.compactions?.length,
    retrying: !!live?.generation?.retry,
  };
}
