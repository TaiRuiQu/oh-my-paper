import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";
import { UPLOAD_LIMITS } from "@/contracts/exam-tasks";
import { RequestError } from "@/server/http/errors";

export async function receiveExamUpload(request: Request, directory: string) {
  if (!request.body) throw new RequestError(400, "请选择试卷文件。");
  if (Number(request.headers.get("content-length")) > UPLOAD_LIMITS.totalBytes)
    throw new RequestError(413, "每次上传总大小不能超过 100 MB。");
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      defParamCharset: "utf8",
      limits: {
        fileSize: UPLOAD_LIMITS.fileBytes,
        files: UPLOAD_LIMITS.files,
        fields: 0,
        parts: UPLOAD_LIMITS.files + 1,
      },
    });
  } catch {
    throw new RequestError(400, "请使用文件上传表单。");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files: { path: string; name: string }[] = [];
  const writes: Promise<void>[] = [];
  let failure: Error | undefined;
  let size = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(
        size > UPLOAD_LIMITS.totalBytes
          ? new RequestError(413, "每次上传总大小不能超过 100 MB。")
          : null,
        chunk,
      );
    },
  });
  parser.on("file", (field, stream, info) => {
    if (field !== "files") {
      failure = new RequestError(400, "上传字段无效。");
      stream.resume();
      return;
    }
    const name = basename((info.filename ?? "").replace(/\\/g, "/"))
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 160);
    const path = join(directory, `${files.length + 1}.upload`);
    files.push({ path, name: name || "未命名试卷" });
    stream.on("limit", () => {
      failure = new RequestError(413, "单个文件不能超过 40 MB。");
    });
    // Attach a rejection handler immediately, even when the request has not finished.
    writes.push(
      pipeline(stream, createWriteStream(path, { mode: 0o600, flags: "wx" })).catch(() => {
        failure ??= new RequestError(400, "文件上传中断，请重新上传。");
      }),
    );
  });
  parser.on("filesLimit", () => {
    failure = new RequestError(413, "每次最多上传 20 个文件。");
  });
  parser.on("partsLimit", () => {
    failure = new RequestError(413, "每次最多上传 20 个文件。");
  });
  parser.on("fieldsLimit", () => {
    failure = new RequestError(400, "上传字段无效。");
  });
  try {
    try {
      await pipeline(
        Readable.fromWeb(request.body as import("node:stream/web").ReadableStream),
        limiter,
        parser,
        { signal: request.signal },
      );
    } catch (error) {
      failure ??=
        error instanceof RequestError ? error : new RequestError(400, "文件上传中断，请重新上传。");
    }
    await Promise.all(writes);
    if (failure) throw failure;
    if (!files.length) throw new RequestError(400, "请选择至少一个试卷文件。");
    for (const file of files) {
      const handle = await open(file.path, "r");
      try {
        const header = Buffer.alloc(8192);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const type = await fileTypeFromBuffer(header.subarray(0, bytesRead)).catch(() => undefined);
        if (!type || !["application/pdf", "image/jpeg", "image/png"].includes(type.mime)) {
          throw new RequestError(422, "仅支持有效的 PDF、JPG 和 PNG 文件，请检查后重新上传。");
        }
      } finally {
        await handle.close();
      }
    }
    return files;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
