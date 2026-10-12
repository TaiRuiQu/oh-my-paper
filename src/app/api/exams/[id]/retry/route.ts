import { requireSession } from "@/server/auth/session";
import { retryExamTask } from "@/server/exams/tasks";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    await retryExamTask(user.id, (await context.params).id);
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
