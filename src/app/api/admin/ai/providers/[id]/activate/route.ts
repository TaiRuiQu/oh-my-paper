import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { activateProvider } from "@/server/ai/settings";
import { z } from "zod";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request.headers);
    requireSameOrigin(request);
    const input = await readJSON(request, z.object({ purpose: z.enum(["exam", "grading"]).default("exam") }), 16_384, true);
    await activateProvider((await context.params).id, input.purpose);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
