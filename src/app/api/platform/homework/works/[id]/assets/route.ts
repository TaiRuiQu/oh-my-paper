import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { saveHomeworkAsset } from "@/server/platform/homework/assets";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request.headers);
    requireSameOrigin(request);
    const { id } = await context.params;
    if (Number(request.headers.get("content-length") || 0) > 32_000_000)
      throw new RequestError(413, "每张作答图片不能超过30 MB。");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new RequestError(400, "请选择作答图片。");
    if (file.size > 30_000_000) throw new RequestError(413, "每张作答图片不能超过30 MB。");
    return Response.json(
      await saveHomeworkAsset(
        { id: session.user.id },
        id,
        Buffer.from(await file.arrayBuffer()),
        file.name,
      ),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
