import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError } from "@/server/http/errors";
import { AREA_LABELS, type PlatformArea } from "@/contracts/navigation";
import { loadPageState } from "@/server/platform/page-state";

export async function GET(request: Request, { params }: { params: Promise<{ area: string }> }) {
  try {
    const session = await requireSession(request.headers);
    const { area } = await params;
    if (!Object.hasOwn(AREA_LABELS, area)) throw new AccessError(404, "功能模块不存在。");
    return Response.json(await loadPageState({ id: session.user.id }, area as PlatformArea), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
