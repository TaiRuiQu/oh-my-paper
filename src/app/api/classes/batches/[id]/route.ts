import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { batchUpload } from "@/server/learning/classes";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const studentId = new URL(request.url).searchParams.get("studentId");
    if (!studentId) throw new RequestError(400, "请选择学生。");
    return Response.json(
      { task: await batchUpload(user.id, (await params).id, studentId, request) },
      { status: 202 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
