import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { DigitalExam } from "@/contracts/exams";

const execute = promisify(execFile);
export type PageImage = {
  page: number;
  key: string;
  width: number;
  height: number;
  rotation: number;
  text: string;
  path: string;
  isPhotograph: boolean;
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
): Promise<{ sources: DigitalExam["sourceFiles"]; pages: PageImage[] }> {
  const sources: DigitalExam["sourceFiles"] = [];
  const pages: PageImage[] = [];
  await mkdir(join(outputDir, "sources"), { mode: 0o700 });
  await mkdir(join(outputDir, "pages"), { mode: 0o700 });
  const renderDir = join(outputDir, ".render");
  await mkdir(renderDir, { mode: 0o700 });
  try {
    for (const [index, input] of inputs.entries()) {
      signal?.throwIfAborted();
      const inputPath = resolve(input);
      const info = await stat(inputPath);
      if (!info.isFile() || info.size > limits.maxFileBytes || !info.size)
        throw new Error("Input must be a nonempty file within the configured size limit.");
      const bytes = await readFile(inputPath);
      const type = await fileTypeFromBuffer(bytes);
      if (!type || !["application/pdf", "image/jpeg", "image/png"].includes(type.mime))
        throw new Error("Supported exam formats: PDF, JPG/JPEG, PNG (checked by file contents).");
      const key = `sources/${index + 1}.${type.ext}`;
      const sourcePath = join(outputDir, key);
      await copyFile(inputPath, sourcePath);
      sources.push({
        name: basename(inputPath),
        key,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: type.mime,
      });
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
            [sourcePath],
            toolOptions,
          );
          pageCount = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
          if (/^Encrypted:\s+yes/m.test(stdout)) throw new Error("encrypted");
        } catch {
          throw new Error(
            "Cannot inspect PDF. Check PDFINFO_PATH; damaged/encrypted PDFs are unsupported.",
          );
        }
        if (
          !Number.isInteger(pageCount) ||
          pageCount < 1 ||
          pages.length + pageCount > limits.maxPages
        )
          throw new Error("PDF exceeds the page limit or has invalid page metadata.");
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
                "-scale-to",
                "2800",
                "-png",
                sourcePath,
                prefix,
              ],
              toolOptions,
            );
          } catch {
            throw new Error(
              `PDF rendering failed at page ${localPage}. Check PDFTOPPM_PATH and the PDF.`,
            );
          }
          let text = "";
          try {
            const result = await execute(
              process.env.PDFTOTEXT_PATH ?? "pdftotext",
              ["-f", String(localPage), "-l", String(localPage), "-layout", sourcePath, "-"],
              toolOptions,
            );
            text = result.stdout.replace(/\f/g, "").trim().slice(0, 30_000);
          } catch {
            /* The visual input is authoritative; text extraction is optional. */
          }
          pages.push(await normalizePage(`${prefix}.png`, outputDir, pages.length + 1, text));
          await rm(`${prefix}.png`);
        }
      } else {
        if (pages.length >= limits.maxPages) throw new Error("Input exceeds the page limit.");
        pages.push(await normalizePage(sourcePath, outputDir, pages.length + 1, "", true));
      }
    }
    return { sources, pages };
  } finally {
    await rm(renderDir, { recursive: true, force: true });
  }
}

async function normalizePage(
  input: string,
  outputDir: string,
  page: number,
  text: string,
  isPhotograph = false,
): Promise<PageImage> {
  const key = `pages/${String(page).padStart(3, "0")}.jpg`;
  const path = join(outputDir, key);
  const info = await sharp(input, { limitInputPixels: 45_000_000 })
    .autoOrient()
    .resize({ width: 2800, height: 2800, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "white" })
    .jpeg({ quality: 95 })
    .toFile(path);
  return {
    page,
    key,
    path,
    width: info.width,
    height: info.height,
    rotation: 0,
    text,
    isPhotograph,
  };
}

export async function rotatePage(page: PageImage, degrees: number) {
  if (!degrees) return;
  const { data, info } = await sharp(page.path)
    .rotate(degrees)
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });
  await writeFile(page.path, data);
  page.width = info.width;
  page.height = info.height;
  page.rotation = degrees;
}

export async function ensureEmptyOutput(outputDir: string) {
  // Require a new output directory to prevent overwriting originals or another parse.
  await mkdir(outputDir, { mode: 0o700 });
  if ((await readdir(outputDir)).length) throw new Error("Output directory must be empty.");
}
