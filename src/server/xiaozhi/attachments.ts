import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { getStoragePaths } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/http/errors";

// Active web content is downloaded as binary, never served as same-origin HTML/SVG.
const mediaTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/plain",
  ".json": "application/json",
};

export async function saveXiaozhiAttachment(ownerId: string, buffer: Buffer, name: string) {
  if (!buffer.length) throw new RequestError(400, "文件为空，请重新选择附件。");
  if (buffer.length > 30_000_000) throw new RequestError(413, "每个附件不能超过 30 MB。");
  const id = randomUUID();
  const directory = join(getStoragePaths().storage, "platform-assets");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, id);
  const mediaType = mediaTypes[extname(name).toLowerCase()] ?? "application/octet-stream";
  await writeFile(path, buffer, { mode: 0o600 });
  try {
    await getDb().platformAsset.create({
      data: { id, ownerId, path, contentType: mediaType, name: name.slice(0, 200) },
    });
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  return {
    id,
    url: `/api/platform/assets/${id}`,
    name: name.slice(0, 200),
    mediaType,
    size: buffer.length,
  };
}
