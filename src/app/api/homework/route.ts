import { isAdminUser } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { requireSameOrigin } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
import { createHomeworkBatch } from "@/server/exams/homework";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    const workflows = await createHomeworkBatch(request, user.id);
    return Response.json({ workflow: workflows[0], workflows }, { status: 202 });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
