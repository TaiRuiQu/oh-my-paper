import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { accessibleAsset } from "@/server/platform/assets";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    const asset = await accessibleAsset(session.user.id, (await context.params).id);
    return new Response(new Uint8Array(asset.buffer), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
