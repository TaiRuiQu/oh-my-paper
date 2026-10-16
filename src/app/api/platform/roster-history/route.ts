import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { loadRosterHistory } from "@/server/platform/roster-history";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(await loadRosterHistory({ id: session.user.id }, query), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
