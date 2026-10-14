import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadScopedAnalytics } from "@/server/platform/scoped-analytics";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const query = new URL(request.url).searchParams;
    return Response.json(
      await loadScopedAnalytics(
        { id: session.user.id },
        {
          assessmentId: query.get("assessmentId") || undefined,
          classroomId: query.get("classroomId") || undefined,
          studentId: query.get("studentId") || undefined,
          kind:
            query.get("kind") === "EXAM"
              ? "EXAM"
              : query.get("kind") === "HOMEWORK"
                ? "HOMEWORK"
                : undefined,
        },
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
