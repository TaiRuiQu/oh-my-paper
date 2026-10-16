import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import type { xiaozhiMessageSchema } from "@/contracts/xiaozhi";
import { createSandboxSession, type SandboxInput } from "@/server/ai/sandbox";
import { accessibleAsset, assetId, saveImage } from "@/server/platform/assets";
import { saveXiaozhiAttachment } from "./attachments";

export function createXiaozhiSandbox(userId: string, directory: string) {
  const session = createSandboxSession({ directory });
  return {
    async stage(message: z.infer<typeof xiaozhiMessageSchema>) {
      const attachments = [];
      for (const part of message.parts) {
        if (part.type !== "file") continue;
        const id = assetId(part.url)!;
        const asset = await accessibleAsset(userId, id);
        const name = (part.filename ?? "附件").replace(/[/\\\x00-\x1f\x7f]/g, "_");
        const folder = join(directory, "inputs", id);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        await writeFile(
          join(folder, name === "." || name === ".." || !name ? "附件" : name),
          asset.buffer,
          { mode: 0o600 },
        );
        attachments.push({
          url: part.url,
          name: part.filename ?? "附件",
          mediaType: asset.contentType,
          path: `/inputs/${id}/${name === "." || name === ".." || !name ? "附件" : name}`,
        });
      }
      return attachments;
    },
    async run(input: SandboxInput, signal?: AbortSignal) {
      const result = await session.run(input, { signal });
      const images = await Promise.all(
        result.images.map(async (image) => {
          const asset = await saveImage(userId, Buffer.from(image.data, "base64"), image.name);
          return { name: image.name, url: asset.url, data: asset.buffer.toString("base64") };
        }),
      );
      const files = await Promise.all(
        result.files.map(async (file) =>
          saveXiaozhiAttachment(userId, Buffer.from(file.data, "base64"), file.name),
        ),
      );
      return { ...result, images, files };
    },
    dispose: session.dispose,
  };
}
