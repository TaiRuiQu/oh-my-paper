import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { teachingHistoryQuerySchema } from "@/contracts/teaching";
import { loadTeachingHistory } from "@/server/platform/teaching/service";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    const { id } = await context.params;
    const query = teachingHistoryQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) throw new RequestError(400, "课堂查询参数无效，请核对日期和分页条件。");
    return Response.json(await loadTeachingHistory({ id: session.user.id }, id, query.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
