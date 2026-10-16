import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadUserDirectory } from "@/server/platform/user-directory";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(
      await loadUserDirectory(
        session.user.id,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
