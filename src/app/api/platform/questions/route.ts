import { questionStatistics } from "@/server/platform/question-stats";
import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { getDb } from "@/server/db/client";
import { getActor, teacher, missing } from "@/server/platform/access";
import type { Prisma } from "@/generated/prisma/client";
import { queryQuestionBank } from "@/server/platform/question-bank";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const actor = await getActor(session.user.id);
    teacher(actor);
    const db = getDb();
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw new RequestError(400, "页码无效。");
    const where: Prisma.QuestionWhereInput = actor.role === "ADMIN" ? {} : { ownerId: actor.id };
    if (params.has("stats"))
      return Response.json(
        await questionStatistics(db, actor.role === "ADMIN" ? undefined : actor.id),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (params.has("id")) {
      const question = await db.question.findFirst({ where: { ...where, id: params.get("id")! } });
      if (!question) throw missing();
      return Response.json({ question }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const result = await queryQuestionBank(
      db,
      actor,
      Object.fromEntries(
        ["subject", "grade", "type", "q", "searchMode"].map((key) => [key, params.get(key) ?? ""]),
      ),
      page,
    );
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, request);
  }
}
