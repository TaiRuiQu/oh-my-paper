import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { getAiJob } from "@/server/platform/ai-jobs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(await getAiJob(session.user.id, (await context.params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
