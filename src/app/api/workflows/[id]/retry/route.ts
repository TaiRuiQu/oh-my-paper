import { isAdminUser } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { retryWorkflow } from "@/server/exams/workflows";
import { requireSameOrigin } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    return Response.json(
      { workflow: await retryWorkflow(user.id, (await context.params).id) },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
