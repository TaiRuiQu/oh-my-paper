import "server-only";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { json, getActor } from "@/server/platform/access";
import { AccessError, RequestError } from "@/server/http/errors";
import { encryptApiKey } from "@/server/ai/credentials";
import { accessibleAsset, assetId } from "@/server/platform/assets";
import { xiaozhiMessageSchema, xiaozhiSettingsSchema, type XiaozhiView } from "@/contracts/xiaozhi";
import { emptyXiaozhiView } from "./view";
import { listSkills } from "./skills";

export const summarySelect = {
  id: true,
  title: true,
  modelId: true,
  skillIds: true,
  updatedAt: true,
} as const;
export async function ownedConversation(userId: string, id: string) {
  await getActor(userId);
  const chat = await getDb().xiaozhiConversation.findFirst({ where: { id, userId } });
  if (!chat) throw new AccessError(404, "对话不存在或无权访问。");
  return chat;
}
export async function conversationSnapshot(userId: string, id: string) {
  const chat = await ownedConversation(userId, id);
  const pending = await getDb().xiaozhiInput.findMany({
    where: { conversationId: id, status: { in: ["QUEUED", "SUBMITTED"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, message: true, mode: true },
  });
  const view = chat.view as unknown as XiaozhiView;
  return {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    skillIds: chat.skillIds,
    updatedAt: chat.updatedAt.toISOString(),
    status: chat.status,
    error: chat.error,
    view: view.messages ? view : emptyXiaozhiView(),
    pending,
  };
}
export async function saveConversationSettings(
  userId: string,
  id: string,
  input: z.infer<typeof xiaozhiSettingsSchema>,
) {
  const chat = await ownedConversation(userId, id);
  if (["QUEUED", "RUNNING"].includes(chat.status))
    throw new RequestError(409, "请先停止当前任务，再修改模型或技能。");
  if (input.modelId) {
    const actor = await getActor(userId);
    if (
      !(await getDb().aiModel.findFirst({
        where: { id: input.modelId, ...(actor.role === "ADMIN" ? {} : { isPublic: true }) },
      }))
    )
      throw new RequestError(400, "请选择可用模型。");
  }
  if (input.skillIds) {
    const skills = await listSkills(userId);
    if (input.skillIds.some((id) => !skills.some((skill) => skill.id === id)))
      throw new RequestError(400, "选择的技能已不存在。");
  }
  const changed = await getDb().xiaozhiConversation.updateMany({
    where: { id, userId, status: { notIn: ["QUEUED", "RUNNING"] } },
    data: input,
  });
  if (!changed.count) throw new RequestError(409, "对话正在运行，请停止后修改。");
  return conversationSnapshot(userId, id);
}
export async function enqueueXiaozhiInput(
  userId: string,
  id: string,
  message: z.infer<typeof xiaozhiMessageSchema>,
  mode: "steer" | "followUp",
  cookie: string,
) {
  const chat = await ownedConversation(userId, id);
  if (!chat.modelId) throw new RequestError(409, "请先选择一个可用模型。");
  for (const part of message.parts)
    if (part.type === "file") {
      const asset = await accessibleAsset(userId, assetId(part.url)!);
      if (part.mediaType !== asset.contentType)
        throw new RequestError(400, "附件类型与原文件不一致，请重新上传。");
    }
  const existing = await getDb().xiaozhiInput.findUnique({ where: { id: message.id } });
  if (existing && existing.conversationId !== id) throw new RequestError(409, "消息编号已被使用。");
  if (existing) return { id: existing.id };
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM xiaozhi_conversations WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const current = await tx.xiaozhiConversation.findUnique({ where: { id } });
    if (!current) throw new AccessError(404, "对话不存在。");
    if (current.cancelRequested)
      throw new RequestError(409, "正在停止当前任务，请稍后再发送新消息。");
    if (
      (await tx.xiaozhiInput.count({
        where: { conversationId: id, status: { in: ["QUEUED", "SUBMITTED"] } },
      })) >= 20
    )
      throw new RequestError(429, "等待中的消息过多，请等待小纸处理。");
    const saved = await tx.xiaozhiInput.upsert({
      where: { id: message.id },
      create: { id: message.id, conversationId: id, message: json(message), mode },
      update: {},
    });
    if (saved.conversationId !== id) throw new RequestError(409, "消息编号已被使用。");
    await tx.xiaozhiConversation.update({
      where: { id },
      data: {
        status: current.workerId ? "RUNNING" : "QUEUED",
        encryptedCookie: encryptApiKey(cookie),
        error: null,
        ...(current.title === "新对话"
          ? {
              title:
                message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join(" ")
                  .trim()
                  .slice(0, 60) || "附件对话",
            }
          : {}),
      },
    });
    return { id: saved.id };
  });
}
