import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { uploadScans } from "@/server/platform/scan-upload";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 155_000_000)
      throw new RequestError(413, "本批扫描材料不能超过 150 MB。");
    return Response.json(await uploadScans(session.user.id, await request.formData()));
  } catch (error) {
    return errorResponse(error, request);
  }
}
