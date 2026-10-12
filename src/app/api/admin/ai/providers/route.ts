import { requireAdmin } from "@/server/auth/authorization";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { providerInputSchema } from "@/contracts/ai-providers";
import { listProviders, saveProvider } from "@/server/ai/settings";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireAdmin(request.headers);
    return Response.json(
      { providers: await listProviders() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    await requireAdmin(request.headers);
    requireSameOrigin(request);
    const provider = await saveProvider(await readJSON(request, providerInputSchema));
    return Response.json({ id: provider.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
