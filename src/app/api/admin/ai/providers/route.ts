import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { providerInputSchema } from "@/contracts/ai-providers";
import { listProviders, saveProvider } from "@/server/ai/settings";
export async function GET(request: Request) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    return Response.json(
      { providers: await listProviders() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
export async function POST(request: Request) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    requireSameOrigin(request);
    await saveProvider(await readJSON(request, providerInputSchema, 65536));
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
