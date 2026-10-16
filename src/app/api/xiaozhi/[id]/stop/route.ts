import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
import { ownedConversation } from "@/server/xiaozhi/store";
import { getDb } from "@/server/db/client";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    const chat = await ownedConversation(user.id, (await context.params).id);
    await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM xiaozhi_conversations WHERE id = ${chat.id} FOR UPDATE`;
      const current = await tx.xiaozhiConversation.findUniqueOrThrow({ where: { id: chat.id } });
      if (["QUEUED", "RUNNING"].includes(current.status))
        await tx.xiaozhiConversation.update({
          where: { id: chat.id },
          data: { cancelRequested: true },
        });
    });
    return Response.json({ id: chat.id });
  } catch (error) {
    return errorResponse(error, request);
  }
}
