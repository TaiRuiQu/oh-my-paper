import { isAdminUser } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { listWorkflows } from "@/server/exams/workflows";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    return Response.json(
      { workflows: await listWorkflows(user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
