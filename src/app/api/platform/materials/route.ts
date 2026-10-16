import { requireSession } from "@/server/auth/session";
import { errorResponse, AccessError, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { getDb } from "@/server/db/client";
import { saveUploadedDocument } from "@/server/platform/assets";

export const runtime = "nodejs";
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
      throw new RequestError(413, "每个图片或 PDF 文件不能超过 30 MB。");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new RequestError(400, "请选择图片或 PDF。");
    const maxPages = Number(form.get("maxPages") ?? 100);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
      throw new RequestError(400, "单次材料页数上限须为 1 至 100。 ");
    const asset = await saveUploadedDocument(
      session.user.id,
      Buffer.from(await file.arrayBuffer()),
      file.name,
      maxPages,
    );
    return Response.json(asset);
  } catch (error) {
    return errorResponse(error, request);
  }
}
