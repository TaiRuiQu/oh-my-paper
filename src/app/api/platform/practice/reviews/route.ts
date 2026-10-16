import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadPracticeReviews } from "@/server/platform/practice/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(
      await loadPracticeReviews(
        { id: session.user.id },
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
