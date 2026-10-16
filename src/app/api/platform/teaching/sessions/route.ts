import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { teachingListQuerySchema } from "@/contracts/teaching";
import { loadTeachingSessions } from "@/server/platform/teaching/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const query = teachingListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) throw new RequestError(400, "课堂查询参数无效，请核对日期和分页条件。");
    return Response.json(await loadTeachingSessions({ id: session.user.id }, query.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
