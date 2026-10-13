import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { activateModelSchema } from "@/contracts/ai-providers";
import { activateModel } from "@/server/ai/settings";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    requireSameOrigin(request);
    const input = await readJSON(request, activateModelSchema);
    await activateModel(
      (await context.params).id,
      input.modelId,
      input.reasoningEffort,
      input.purpose,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
