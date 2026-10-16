import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadTeachingPermissionsHistory } from "@/server/platform/teaching-permissions";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    const { id } = await context.params;
    return Response.json(
      await loadTeachingPermissionsHistory(
        session.user.id,
        id,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
