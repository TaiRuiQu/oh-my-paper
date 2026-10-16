import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getActor } from "@/server/platform/access";
import { errorResponse, RequestError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { xiaozhiSkillSchema } from "@/contracts/xiaozhi";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    await getActor(user.id);
    if ((await getDb().xiaozhiSkill.count({ where: { userId: user.id } })) >= 100)
      throw new RequestError(429, "最多保存 100 个个人技能。");
    return Response.json(
      await getDb().xiaozhiSkill.create({
        data: { ...(await readJSON(request, xiaozhiSkillSchema, 100000)), userId: user.id },
        select: { id: true, name: true },
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
