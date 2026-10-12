import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { practiceAnswerSchema } from "@/contracts/learning";
import { practiceView, submitPractice } from "@/server/learning/practice";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const { user } = await requireSession(request.headers); return Response.json(await practiceView(user.id, (await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try { const { user } = await requireSession(request.headers); requireSameOrigin(request); await submitPractice(user.id, (await context.params).id, await readJSON(request, practiceAnswerSchema)); return Response.json({ ok: true }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
