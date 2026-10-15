import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { errorResponse, AccessError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { xiaozhiSkillSchema } from "@/contracts/xiaozhi";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    const changed = await getDb().xiaozhiSkill.updateMany({
      where: { id: (await context.params).id, userId: user.id },
      data: await readJSON(request, xiaozhiSkillSchema, 100000),
    });
    if (!changed.count) throw new AccessError(404, "个人技能不存在。");
    return Response.json({ saved: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    const id = (await context.params).id;
    await getDb().$transaction(async (tx) => {
      const changed = await tx.xiaozhiSkill.deleteMany({ where: { id, userId: user.id } });
      if (!changed.count) throw new AccessError(404, "个人技能不存在。");
      const chats = await tx.xiaozhiConversation.findMany({
        where: { userId: user.id, skillIds: { has: id } },
        select: { id: true, skillIds: true },
      });
      for (const chat of chats)
        await tx.xiaozhiConversation.update({
          where: { id: chat.id },
          data: { skillIds: chat.skillIds.filter((skillId) => skillId !== id) },
        });
    });
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}
