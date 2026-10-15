import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { xiaozhiEvents } from "@/server/xiaozhi/events";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, session } = await requireSession(request.headers);
    return await xiaozhiEvents(
      request,
      user.id,
      (await context.params).id,
      new Date(session.expiresAt),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
