import { replayPaperSchema } from "@/contracts/revision-papers";
import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { reproducePaper } from "@/server/platform/revision-papers";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    return Response.json(
      await reproducePaper(session.user.id, await readJSON(request, replayPaperSchema, 150_000)),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
