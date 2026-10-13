import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { getActiveTaskCounts } from "@/server/jobs/active-tasks";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json(await getActiveTaskCounts(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
