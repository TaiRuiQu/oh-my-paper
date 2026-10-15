import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { aiProgressResponse } from "@/server/platform/ai-progress";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return await aiProgressResponse(request, session.user.id, session.session.expiresAt, {
      search: true,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
