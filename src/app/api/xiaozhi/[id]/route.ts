import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { xiaozhiSettingsSchema } from "@/contracts/xiaozhi";
import {
  conversationSnapshot,
  ownedConversation,
  saveConversationSettings,
} from "@/server/xiaozhi/store";
import { getDb } from "@/server/db/client";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getStoragePaths } from "@/server/config/env";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json(await conversationSnapshot(user.id, (await context.params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    return Response.json(
      await saveConversationSettings(
        user.id,
        (await context.params).id,
        await readJSON(request, xiaozhiSettingsSchema),
      ),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    const chat = await ownedConversation(user.id, (await context.params).id);
    const deleted = await getDb().xiaozhiConversation.deleteMany({
      where: {
        id: chat.id,
        userId: user.id,
        workerId: null,
        status: { notIn: ["QUEUED", "RUNNING"] },
      },
    });
    if (!deleted.count) throw new RequestError(409, "请先停止任务，再删除对话。");
    await rm(join(getStoragePaths().storage, "xiaozhi", chat.id), { force: true, recursive: true });
    return Response.json({ id: chat.id });
  } catch (error) {
    return errorResponse(error, request);
  }
}
