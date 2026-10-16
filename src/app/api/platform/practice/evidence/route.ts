import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadPracticeEvidence } from "@/server/platform/practice/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(
      await loadPracticeEvidence(
        { id: session.user.id },
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
