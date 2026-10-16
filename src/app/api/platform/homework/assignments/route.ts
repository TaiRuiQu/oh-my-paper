import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadHomeworkAssignments } from "@/server/platform/homework/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(
      await loadHomeworkAssignments(
        { id: session.user.id },
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
