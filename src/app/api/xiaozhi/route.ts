import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActor } from "@/server/platform/access";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { xiaozhiSettingsSchema } from "@/contracts/xiaozhi";
import { summarySelect, saveConversationSettings } from "@/server/xiaozhi/store";
import { listSkills } from "@/server/xiaozhi/skills";

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    const actor = await getActor(user.id);
    const [conversations, models, skills] = await Promise.all([
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
    ]);
    return Response.json(
      {
        conversations,
        models: models.map((model) => ({ id: model.id, name: model.displayName || model.name })),
        skills,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    await getActor(user.id);
    const settings = await readJSON(request, xiaozhiSettingsSchema, 16384, true);
    const chat = await getDb().xiaozhiConversation.create({ data: { userId: user.id } });
    try {
      return Response.json(await saveConversationSettings(user.id, chat.id, settings), {
        status: 201,
      });
    } catch (error) {
      await getDb().xiaozhiConversation.delete({ where: { id: chat.id } });
      throw error;
    }
  } catch (error) {
    return errorResponse(error, request);
  }
}
