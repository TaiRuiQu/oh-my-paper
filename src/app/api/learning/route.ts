import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { learningOverview } from "@/server/learning/service";
import { topicSchema } from "@/contracts/learning";
import { getDb } from "@/server/db/client";
export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json(await learningOverview(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const data = await readJSON(
      request,
      z.object({ entryKey: z.string().max(240), topicId: topicSchema }),
    );
    if (!(await learningOverview(user.id)).entries.some((e) => e.key === data.entryKey))
      throw new AccessError(404, "错题不存在。");
    await getDb().learningTag.upsert({
      where: { userId_entryKey: { userId: user.id, entryKey: data.entryKey } },
      create: { userId: user.id, ...data },
      update: { topicId: data.topicId },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
