import type { Metadata } from "next";
import { requirePageSession } from "@/server/auth/session";
import { getActor } from "@/server/platform/access";
import { getDb } from "@/server/db/client";
import { summarySelect } from "@/server/xiaozhi/store";
import { listSkills } from "@/server/xiaozhi/skills";
import { XiaozhiClient } from "@/components/xiaozhi/chat";
import "./xiaozhi.css";

export const metadata: Metadata = { title: "小纸 · 你的教学助手" };
export default async function XiaozhiPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { user } = await requirePageSession();
  const actor = await getActor(user.id);
  const [conversations, models, skills, query] = await Promise.all([
    getDb().xiaozhiConversation.findMany({
      where: { userId: user.id },
      select: summarySelect,
      orderBy: { updatedAt: "desc" },
    }),
    getDb().aiModel.findMany({
      where: actor.role === "ADMIN" ? {} : { isPublic: true },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: "asc" },
    }),
    listSkills(user.id),
    searchParams,
  ]);
  return (
    <XiaozhiClient
      actor={actor}
      initialId={query.chat ?? null}
      initialData={{
        conversations: conversations.map((chat) => ({
          ...chat,
          updatedAt: chat.updatedAt.toISOString(),
        })),
        models: models.map((model) => ({ id: model.id, name: model.displayName || model.name })),
        skills,
      }}
    />
  );
}
