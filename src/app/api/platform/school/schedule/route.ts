import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { schoolDateSchema } from "@/contracts/school";
import { loadSchoolSchedule } from "@/server/platform/school/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const query = new URL(request.url).searchParams;
    const termId = query.get("termId");
    const startDate = schoolDateSchema.safeParse(query.get("startDate"));
    const endDate = schoolDateSchema.safeParse(query.get("endDate"));
    if (
      !termId ||
      termId.length > 128 ||
      !startDate.success ||
      !endDate.success ||
      startDate.data > endDate.data
    )
      throw new RequestError(400, "请选择学期和有效的起止日期。");
    return Response.json(
      await loadSchoolSchedule(
        { id: session.user.id },
        {
          termId,
          startDate: startDate.data,
          endDate: endDate.data,
        },
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
