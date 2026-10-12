import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse, AccessError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { providerInputSchema } from "@/contracts/ai-providers";
import { saveProvider } from "@/server/ai/settings";
import { getDb } from "@/server/db/client";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    await requireAdmin(request.headers);
    requireSameOrigin(request);
    await saveProvider(await readJSON(request, providerInputSchema), (await context.params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await requireAdmin(request.headers);
    requireSameOrigin(request);
    const result = await getDb().aiProvider.deleteMany({
      where: { id: (await context.params).id },
    });
    if (!result.count) throw new AccessError(404, "提供商不存在。");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
