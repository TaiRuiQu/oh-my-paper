import { requireAdmin } from "@/server/auth/authorization";
import { adminListSchema } from "@/contracts/admin";
import { listAllExams } from "@/server/admin/exams";
import { errorResponse, RequestError } from "@/server/http/errors";
export async function GET(request: Request) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    const query = adminListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new RequestError(400, "搜索或分页参数无效。");
    return Response.json(await listAllExams(query.data.search, query.data.page), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
