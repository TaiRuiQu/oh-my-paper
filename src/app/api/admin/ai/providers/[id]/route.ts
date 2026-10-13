import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { providerInputSchema } from "@/contracts/ai-providers";
import { saveProvider } from "@/server/ai/settings";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    requireSameOrigin(request);
    await saveProvider(
      await readJSON(request, providerInputSchema, 65536),
      (await context.params).id,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
