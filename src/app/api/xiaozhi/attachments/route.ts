import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { getActor } from "@/server/platform/access";
import { saveXiaozhiAttachment } from "@/server/xiaozhi/attachments";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    await getActor(user.id);
    if (Number(request.headers.get("content-length") ?? 0) > 32000000)
      throw new RequestError(413, "每个附件不能超过 30 MB。");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new RequestError(400, "请选择附件。");
    if (file.size > 30_000_000) throw new RequestError(413, "每个附件不能超过 30 MB。");
    return Response.json(
      await saveXiaozhiAttachment(user.id, Buffer.from(await file.arrayBuffer()), file.name),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
