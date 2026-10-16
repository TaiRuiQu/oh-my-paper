import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { schoolCommandSchema } from "@/contracts/school";
import { executeSchoolCommand } from "@/server/platform/school/service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const command = await readJSON(request, schoolCommandSchema, 1_000_000);
    return Response.json(await executeSchoolCommand({ id: session.user.id }, command));
  } catch (error) {
    return errorResponse(error, request);
  }
}
