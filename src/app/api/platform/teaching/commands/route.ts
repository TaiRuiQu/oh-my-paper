import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { teachingCommandSchema } from "@/contracts/teaching";
import { executeTeachingCommand } from "@/server/platform/teaching/service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const command = await readJSON(request, teachingCommandSchema, 1_000_000);
    return Response.json(await executeTeachingCommand({ id: session.user.id }, command));
  } catch (error) {
    return errorResponse(error, request);
  }
}
