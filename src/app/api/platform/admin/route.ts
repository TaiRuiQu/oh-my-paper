import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { adminCommandSchema, executeAdmin, loadAdmin } from "@/server/platform/admin";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(await loadAdmin(session.user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    return Response.json(
      await executeAdmin(session.user.id, await readJSON(request, adminCommandSchema)),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
