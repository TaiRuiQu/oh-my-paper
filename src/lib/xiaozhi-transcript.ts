import type { XiaozhiMessage, XiaozhiPart } from "@/contracts/xiaozhi";

export function groupXiaozhiMessages(messages: XiaozhiMessage[]) {
  const groups: { id: string; role: XiaozhiMessage["role"]; messages: XiaozhiMessage[] }[] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    if (message.role === "assistant" && previous?.role === "assistant")
      previous.messages.push(message);
    else groups.push({ id: message.id, role: message.role, messages: [message] });
  }
  return groups;
}

export function splitXiaozhiReply(messages: XiaozhiMessage[]) {
  const last = messages.at(-1);
  const hasReply =
    last?.parts.some((part) => part.type === "text") &&
    !last.parts.some((part) => part.type === "tool");
  const reply: XiaozhiPart[] =
    hasReply && last ? last.parts.filter((part) => part.type !== "thinking") : [];
  const process = messages.flatMap((message) =>
    message === last && hasReply
      ? message.parts.filter((part) => part.type === "thinking")
      : message.parts,
  );
  return { reply, process };
}
