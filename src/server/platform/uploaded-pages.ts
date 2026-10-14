import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { RequestError } from "@/server/http/errors";
const execute = promisify(execFile);
export const MAX_UPLOAD_BYTES = 30_000_000;
export const MAX_DOCUMENT_PAGES = 100;
export function isPdfUpload(input: Buffer, name: string) {
  const pdf = input.subarray(0, 1024).includes(Buffer.from("%PDF-"));
  if (/\.pdf$/i.test(name) && !pdf)
    throw new RequestError(400, "PDF 无法读取，请检查文件是否完整。");
  return pdf;
}
export async function decodeUploadedPages(
  input: Buffer,
  name: string,
  maxPages = MAX_DOCUMENT_PAGES,
): Promise<{ buffer: Buffer; name: string; page: number }[]> {
  if (!input.length) throw new RequestError(400, "文件为空，请重新选择图片或 PDF。");
  if (input.length > MAX_UPLOAD_BYTES)
    throw new RequestError(413, "每个图片或 PDF 文件不能超过 30 MB。");
  if (!isPdfUpload(input, name)) {
    try {
      return [
        {
          buffer: await sharp(input, { limitInputPixels: 50_000_000 }).rotate().png().toBuffer(),
          name,
          page: 1,
        },
      ];
    } catch {
      throw new RequestError(400, "文件无法读取，请上传 PNG、JPEG、WebP 或 PDF。");
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "omp-pdf-"));
  try {
    const source = join(directory, "source.pdf");
    await writeFile(source, input, { mode: 0o600 });
    let stdout: string;
    try {
      ({ stdout } = await execute("pdfinfo", [source], {
        timeout: 15_000,
        maxBuffer: 1_000_000,
        env: { ...process.env, LC_ALL: "C" },
      }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        throw new RequestError(503, "PDF 处理服务尚未配置，请安装 poppler-utils 后重试。");
      throw new RequestError(400, "PDF 无法读取或需要密码，请上传完整、未加密的 PDF。");
    }
    const count = Number(/^Pages:\s+(\d+)\s*$/m.exec(stdout)?.[1]);
    if (!Number.isInteger(count) || count < 1)
      throw new RequestError(400, "PDF 中没有可读取的页面。");
    if (count > maxPages)
      throw new RequestError(413, `本次最多处理 ${maxPages} 页，请拆分 PDF 后上传。`);
    const prefix = join(directory, "page");
    try {
      await execute(
        "pdftoppm",
        ["-png", "-r", "300", "-scale-to", "3508", "-f", "1", "-l", String(count), source, prefix],
        { timeout: 120_000, maxBuffer: 1_000_000 },
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        throw new RequestError(503, "PDF 处理服务尚未配置，请安装 poppler-utils 后重试。");
      throw new RequestError(400, "PDF 页面转换失败，请检查文件或拆分后重试。");
    }
    const files = (await readdir(directory))
      .filter((file) => /^page-\d+\.png$/.test(file))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (files.length !== count)
      throw new RequestError(400, "PDF 部分页面无法读取，请检查文件后重试。");
    const pages = [];
    let total = 0;
    for (const [index, file] of files.entries()) {
      const buffer = await readFile(join(directory, file));
      total += buffer.length;
      if (total > 150_000_000)
        throw new RequestError(413, "PDF 转换后的页面超过 150 MB，请拆分文件后上传。");
      pages.push({
        buffer,
        name: `${name.replace(/\.pdf$/i, "")} · 第 ${index + 1} 页.png`,
        page: index + 1,
      });
    }
    return pages;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
