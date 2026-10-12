import sharp from "sharp";
import { z } from "zod";
import { providerInputSchema } from "@/contracts/ai-providers";
import { requireAdmin } from "@/server/auth/authorization";
import { decryptApiKey } from "@/server/ai/credentials";
import { createProviderExamModel } from "@/server/ai/providers";
import { getDb } from "@/server/db/client";
import { errorResponse, RequestError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireAdmin(request.headers);
    requireSameOrigin(request);
    const input = await readJSON(
      request,
      providerInputSchema.extend({ id: z.string().optional() }),
    );
    const existing = input.id
      ? await getDb().aiProvider.findUnique({ where: { id: input.id } })
      : null;
    const apiKey = input.apiKey || (existing ? decryptApiKey(existing.encryptedApiKey) : "");
    if (!apiKey) throw new RequestError(400, "请先填写 API key。");
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const model = createProviderExamModel(
      { ...input, maxOutputTokens: 1024, timeoutSeconds: 30 },
      apiKey,
    );
    try {
      const result = await model.generate({
        name: "vision_connection_test",
        schema: z.object({ color: z.enum(["red", "green", "blue"]) }),
        system:
          "Identify the dominant color of the provided image. Return JSON matching the schema.",
        content: [{ type: "file", data: image, mediaType: "image/png" }],
        signal: request.signal,
      });
      if (result.output.color !== "red") throw new Error("Image test did not match.");
      return Response.json({
        ok: true,
        message: "连接成功，图片输入和结构化输出测试通过。识别质量请用实际试卷核对。",
      });
    } catch {
      throw new RequestError(
        422,
        "测试未通过。请检查接口类型、base URL、API key、模型名称及模型的图片输入/JSON 输出能力。",
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
