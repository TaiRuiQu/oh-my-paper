import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { retryAiJob } from "@/server/platform/ai-jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    return Response.json(await retryAiJob(session.user.id, (await context.params).id), {
      status: 202,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
