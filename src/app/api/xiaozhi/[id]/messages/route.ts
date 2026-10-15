import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { xiaozhiMessageSchema } from "@/contracts/xiaozhi";
import { enqueueXiaozhiInput } from "@/server/xiaozhi/store";
const schema = z.strictObject({
  message: xiaozhiMessageSchema,
  mode: z.enum(["steer", "followUp"]).default("followUp"),
});
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession(request.headers);
    const { message, mode } = await readJSON(request, schema, 100000);
    return Response.json(
      await enqueueXiaozhiInput(
        user.id,
        (await context.params).id,
        message,
        mode,
        request.headers.get("cookie") ?? "",
      ),
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
