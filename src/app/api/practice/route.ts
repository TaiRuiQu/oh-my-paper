import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { practiceCreateSchema } from "@/contracts/learning";
import { createPractice } from "@/server/learning/practice";
export async function POST(request: Request) {
  try { const { user } = await requireSession(request.headers); requireSameOrigin(request); return Response.json({ id: await createPractice(user.id, await readJSON(request, practiceCreateSchema)) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
