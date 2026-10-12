import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { generateExamSolutionsTask } from "@/server/exams/tasks";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    await generateExamSolutionsTask(user.id, (await context.params).id);
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
