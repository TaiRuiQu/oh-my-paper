import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { enqueueAiJob, listAiJobs } from "@/server/platform/ai-jobs";
import { aiRequestSchema } from "@/contracts/platform-ai";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(await listAiJobs(session.user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    return Response.json(
      await enqueueAiJob(session.user.id, await readJSON(request, aiRequestSchema, 1_000_000)),
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
