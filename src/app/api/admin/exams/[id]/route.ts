import { requireAdmin } from "@/server/auth/authorization";
import { reviewExam } from "@/server/admin/exams";
import { errorResponse } from "@/server/http/errors";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    return Response.json(await reviewExam((await context.params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
