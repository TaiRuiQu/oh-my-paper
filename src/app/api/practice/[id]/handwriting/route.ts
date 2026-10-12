import { requireSession } from "@/server/auth/session";
import { requireSameOrigin } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
import { uploadPracticeHandwriting } from "@/server/learning/practice";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    await uploadPracticeHandwriting(user.id, (await params).id, request);
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
