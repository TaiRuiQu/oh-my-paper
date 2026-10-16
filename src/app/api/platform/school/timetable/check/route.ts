import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { checkSchoolTimetable } from "@/server/platform/school/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const termId = new URL(request.url).searchParams.get("termId");
    if (!termId || termId.length > 128) throw new RequestError(400, "请选择有效学期。");
    return Response.json(await checkSchoolTimetable({ id: session.user.id }, termId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
