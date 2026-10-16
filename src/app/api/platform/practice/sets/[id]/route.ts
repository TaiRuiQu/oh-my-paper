import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadPracticeSet } from "@/server/platform/practice/service";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    const { id } = await context.params;
    return Response.json(await loadPracticeSet({ id: session.user.id }, id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
