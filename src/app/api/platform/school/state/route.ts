import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadSchoolState } from "@/server/platform/school/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(await loadSchoolState({ id: session.user.id }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
