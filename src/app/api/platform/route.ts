import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { executeCommand, loadState } from "@/server/platform/service";
import { commandSchema } from "@/server/platform/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    return Response.json(await loadState({ id: session.user.id }), {
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
    const command = await readJSON(request, commandSchema, 2_000_000);
    return Response.json(await executeCommand({ id: session.user.id }, command));
  } catch (error) {
    return errorResponse(error, request);
  }
}
