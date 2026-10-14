import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { getDb } from "@/server/db/client";
import { saveImage } from "@/server/platform/assets";

export async function POST(request: Request) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const user = await getDb().user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (!user || !["ADMIN", "TEACHER"].includes(user.role))
      throw new AccessError(403, "需要教师权限。");
    if (Number(request.headers.get("content-length") || 0) > 32_000_000)
      throw new RequestError(413, "图片不能超过 30 MB。");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new RequestError(400, "请选择图片。");
    const asset = await saveImage(
      session.user.id,
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );
    return Response.json({ id: asset.id, url: asset.url });
  } catch (error) {
    return errorResponse(error, request);
  }
}
