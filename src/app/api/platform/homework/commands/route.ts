import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { homeworkCommandSchema } from "@/contracts/homework";
import { executeHomeworkCommand } from "@/server/platform/homework/service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const command = await readJSON(request, homeworkCommandSchema, 2_000_000);
    return Response.json(await executeHomeworkCommand({ id: session.user.id }, command));
  } catch (error) {
    return errorResponse(error, request);
  }
}
