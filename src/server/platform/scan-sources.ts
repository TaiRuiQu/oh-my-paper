import "server-only";
import { z } from "zod";
import { RequestError } from "@/server/http/errors";
import { readOwnedAsset } from "./assets";
import { decodeUploadedPages, isPdfUpload, MAX_UPLOAD_BYTES } from "./uploaded-pages";
const references = z
  .array(
    z.union([
      z.strictObject({ assetUrl: z.string().max(2048) }),
      z.strictObject({ fileIndex: z.number().int().min(0).max(99) }),
    ]),
  )
  .min(1)
  .max(100);
export type ScanSource = { buffer: Buffer; name: string; assetUrl?: string };
/** References preserve mixed image/PDF page order and avoid re-uploading PDF preview assets. */
export async function resolveScanSources(actorId: string, form: FormData): Promise<ScanSource[]> {
  const files = form.getAll("files").filter((file): file is File => file instanceof File);
  if (files.length > 100 || files.reduce((sum, file) => sum + file.size, 0) > 150_000_000)
    throw new RequestError(413, "本批扫描材料最多 100 页、150 MB。");
  let refs: z.infer<typeof references>;
  try {
    refs = form.has("sources")
      ? references.parse(JSON.parse(String(form.get("sources"))))
      : references.parse(files.map((_, fileIndex) => ({ fileIndex })));
  } catch {
    throw new RequestError(400, "请选择 1 至 100 页扫描图片或 PDF。");
  }
  const indexes = refs
    .filter((ref): ref is { fileIndex: number } => "fileIndex" in ref)
    .map((ref) => ref.fileIndex);
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.length !== files.length ||
    indexes.some((index) => index >= files.length)
  )
    throw new RequestError(400, "扫描文件引用或顺序无效。");
  const sources: ScanSource[] = [];
  let total = 0;
  for (const ref of refs) {
    if ("assetUrl" in ref) {
      const asset = await readOwnedAsset(actorId, ref.assetUrl);
      sources.push({ ...asset, assetUrl: ref.assetUrl });
      total += asset.buffer.length;
    } else {
      const file = files[ref.fileIndex];
      if (file.size > MAX_UPLOAD_BYTES)
        throw new RequestError(413, "每个图片或 PDF 文件不能超过 30 MB。");
      const buffer = Buffer.from(await file.arrayBuffer());
      const pages = isPdfUpload(buffer, file.name)
        ? await decodeUploadedPages(buffer, file.name, 100 - sources.length)
        : [{ buffer, name: file.name }];
      sources.push(...pages);
      total += pages.reduce((sum, page) => sum + page.buffer.length, 0);
    }
    if (sources.length > 100 || total > 150_000_000)
      throw new RequestError(413, "本批扫描材料展开后最多 100 页、150 MB，请拆分后上传。");
  }
  return sources;
}
