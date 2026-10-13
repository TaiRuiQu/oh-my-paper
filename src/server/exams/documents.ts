import "server-only";
import { AppError } from "@/server/errors";
import { logError } from "@/server/logger";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { scanDocumentPage } from "./document-scan";
const execute = promisify(execFile);
export type PageImage = {
  page: number;
  width: number;
  height: number;
  path: string;
};
export type DocumentLimits = { maxFileBytes: number; maxPages: number; processTimeoutMs: number };
export const DEFAULT_LIMITS: DocumentLimits = {
  maxFileBytes: 40 * 1024 * 1024,
  maxPages: 50,
  processTimeoutMs: 60_000,
};

export async function prepareDocuments(
  inputs: string[],
  outputDir: string,
  limits: DocumentLimits,
  signal?: AbortSignal,
): Promise<PageImage[]> {
  const pages: PageImage[] = [];
  await mkdir(join(outputDir, "pages"), { mode: 0o700 });
  const renderDir = join(outputDir, ".render");
  await mkdir(renderDir, { mode: 0o700 });
  try {
    for (const [index, input] of inputs.entries()) {
      signal?.throwIfAborted();
      const inputPath = resolve(input);
      const info = await stat(inputPath);
      if (!info.isFile() || info.size > limits.maxFileBytes || !info.size)
        throw new AppError(`第 ${index + 1} 个文件为空或超过大小限制。`, "FILE_SIZE_INVALID", 422);
      const bytes = await readFile(inputPath);
      const type = await fileTypeFromBuffer(bytes);
      if (!type || !["application/pdf", "image/jpeg", "image/png"].includes(type.mime))
        throw new AppError(
          `第 ${index + 1} 个文件不是有效的 PDF、JPG 或 PNG。`,
          "FILE_TYPE_INVALID",
          422,
        );
      if (type.mime === "application/pdf") {
        const toolOptions = {
          timeout: limits.processTimeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          signal,
          env: { ...process.env, LC_ALL: "C" },
        };
        let pageCount: number;
        try {
          const { stdout } = await execute(
            process.env.PDFINFO_PATH ?? "pdfinfo",
            [inputPath],
            toolOptions,
          );
          pageCount = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
          if (/^Encrypted:\s+yes/m.test(stdout))
            throw new AppError(
              `第 ${index + 1} 个 PDF 已加密，请解除密码后上传。`,
              "PDF_ENCRYPTED",
              422,
            );
        } catch (cause) {
          if (cause instanceof AppError) throw cause;
          throw new AppError(
            `无法检查第 ${index + 1} 个 PDF，请确认文件完整且 pdfinfo 已安装（PDFINFO_PATH）。`,
            "PDF_INSPECT_FAILED",
            422,
            { cause },
          );
        }
        if (
          !Number.isInteger(pageCount) ||
          pageCount < 1 ||
          pages.length + pageCount > limits.maxPages
        )
          throw new AppError(
            `第 ${index + 1} 个 PDF 的页数无效或总页数超过 ${limits.maxPages} 页。`,
            "PDF_PAGE_LIMIT",
            422,
          );
        for (let localPage = 1; localPage <= pageCount; localPage++) {
          signal?.throwIfAborted();
          const prefix = join(renderDir, `${index}-${localPage}`);
          try {
            await execute(
              process.env.PDFTOPPM_PATH ?? "pdftoppm",
              [
                "-f",
                String(localPage),
                "-l",
                String(localPage),
                "-singlefile",
                "-r",
                "300",
                "-png",
                inputPath,
                prefix,
              ],
              toolOptions,
            );
          } catch (cause) {
            throw new AppError(
              `第 ${index + 1} 个 PDF 的第 ${localPage} 页渲染失败，请检查文件和 pdftoppm（PDFTOPPM_PATH）。`,
              "PDF_RENDER_FAILED",
              422,
              { cause },
            );
          }
          pages.push(
            await normalizePage(
              `${prefix}.png`,
              outputDir,
              pages.length + 1,
              false,
              limits,
              signal,
            ),
          );
          await rm(`${prefix}.png`);
        }
      } else {
        if (pages.length >= limits.maxPages)
          throw new AppError(`总页数超过 ${limits.maxPages} 页。`, "PAGE_LIMIT", 422);
        pages.push(
          await normalizePage(inputPath, outputDir, pages.length + 1, true, limits, signal),
        );
      }
    }
    return pages;
  } finally {
    await rm(renderDir, { recursive: true, force: true }).catch((error) => {
      logError("pdf.render.cleanup.failed", error);
    });
  }
}

async function normalizePage(
  input: string,
  outputDir: string,
  page: number,
  detect: boolean,
  limits: DocumentLimits,
  signal?: AbortSignal,
): Promise<PageImage> {
  const key = `pages/${String(page).padStart(3, "0")}.jpg`;
  const path = join(outputDir, key);
  // EXIF orientation and alpha compositing happen at native resolution before detection.
  const original = join(outputDir, ".render", `${page}.original.png`);
  await sharp(input, { limitInputPixels: 45_000_000 })
    .autoOrient()
    .flatten({ background: "white" })
    .png()
    .toFile(original);
  const info = await scanDocumentPage({
    input: original,
    output: path,
    detect,
    timeoutMs: limits.processTimeoutMs,
    signal,
  });
  await rm(original);
  return {
    page,
    path,
    width: info.width,
    height: info.height,
  };
}
