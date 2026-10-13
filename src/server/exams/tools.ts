import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import sharp from "sharp";
import { materialSchema, type Material } from "@/contracts/exams";
import { AppError } from "@/server/errors";
import type { PageImage } from "./documents";
import { pythonInputSchema, runSandboxPython } from "./python-sandbox";
function pixels(box: Material, page: PageImage) {
  const left = Math.floor(box.x * page.width),
    top = Math.floor(box.y * page.height);
  return {
    left,
    top,
    width: Math.max(
      1,
      Math.min(page.width - left, Math.ceil((box.x + box.width) * page.width) - left),
    ),
    height: Math.max(
      1,
      Math.min(page.height - top, Math.ceil((box.y + box.height) * page.height) - top),
    ),
  };
}
export function createInspectionTools(
  pages: PageImage[],
  directory: string,
  signal?: AbortSignal,
  validatePageUpdates?: (numbers: number[]) => void,
) {
  const findPage = (number: number) => {
    signal?.throwIfAborted();
    const page = pages.find((page) => page.page === number);
    if (!page)
      throw new AppError(
        `页面 ${number} 不存在，当前文档共有 ${pages.length} 页。`,
        "PAGE_NOT_FOUND",
        422,
      );
    return page;
  };
  const imageOutput = async (output: { images: string[] }) => ({
    type: "content" as const,
    value: [
      { type: "text" as const, text: JSON.stringify(output) },
      ...(await Promise.all(
        output.images.map(async (key) => ({
          type: "file" as const,
          mediaType: "image/jpeg",
          data: {
            type: "data" as const,
            data: (await readFile(join(directory, key))).toString("base64"),
          },
        })),
      )),
    ],
  });
  return {
    read_pages: tool({
      description: "View up to three current full-page images and their dimensions.",
      inputSchema: z.strictObject({ pages: z.array(z.number().int().positive()).min(1).max(3) }),
      execute: async ({ pages: numbers }) => {
        const selected = numbers.map(findPage);
        return {
          pages: selected.map(({ page, width, height }) => ({ page, width, height })),
          images: selected.map((page) => relative(directory, page.path)),
        };
      },
      toModelOutput: ({ output }) => imageOutput(output),
    }),
    inspect_image: tool({
      description:
        "Crop, enlarge or sharpen a page region. Coordinates are normalized against the current page; only the preview is changed.",
      inputSchema: z.strictObject({
        region: materialSchema,
        scale: z.number().min(1).max(3),
        sharpen: z.boolean(),
      }),
      execute: async ({ region, scale, sharpen }) => {
        const page = findPage(region.page),
          key = `agent/${randomUUID()}.jpg`;
        const box = pixels(region, page);
        let image = sharp(page.path)
          .extract(box)
          .resize({
            width: Math.min(2800, Math.ceil(box.width * scale)),
            height: Math.min(2800, Math.ceil(box.height * scale)),
            fit: "inside",
          });
        if (sharpen) image = image.sharpen();
        const info = await image.jpeg({ quality: 95 }).toFile(join(directory, key));
        return { region, width: info.width, height: info.height, images: [key] };
      },
      toModelOutput: ({ output }) => imageOutput(output),
    }),
    python: tool({
      description:
        "Run Python with Pillow in a local sandbox without network. Pages are at /workspace/pages/001.jpg; previews at /workspace/agent/<UUID>.jpg. Use print() for text. Save output/<name>.png and list filenames in images. Each call starts fresh, with 60s wall time and 512 MiB memory. To rotate a page, return its corrected whole image and set replacePages before saving material coordinates; otherwise use [].",
      inputSchema: pythonInputSchema,
      execute: async (input, { abortSignal }) => {
        const executionSignal =
          signal && abortSignal ? AbortSignal.any([signal, abortSignal]) : (signal ?? abortSignal);
        const numbers = input.replacePages.map((update) => update.page);
        if (new Set(numbers).size !== numbers.length)
          throw new AppError("同一页面不能在一次调用中替换多次。", "PAGE_UPDATE_INVALID", 422);
        for (const update of input.replacePages) {
          findPage(update.page);
          if (!input.images.includes(update.image))
            throw new AppError("替换页面的图像必须包含在 images 中。", "PAGE_UPDATE_INVALID", 422);
        }
        validatePageUpdates?.(numbers);
        const result = await runSandboxPython({
          ...input,
          pages,
          directory,
          signal: executionSignal,
        });
        if (result.exitCode !== 0) return { ...result, images: [], previews: [], pages: [] };
        const previews = await Promise.all(
          result.images.map(async (output) => {
            const key = `agent/${randomUUID()}.jpg`;
            const info = await sharp(Buffer.from(output.data, "base64"), {
              limitInputPixels: 45_000_000,
            })
              .flatten({ background: "white" })
              .resize({ width: 2800, height: 2800, fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 95 })
              .toFile(join(directory, key));
            return { name: output.name, image: key, width: info.width, height: info.height };
          }),
        );
        executionSignal?.throwIfAborted();
        // Recognition and Python may run concurrently in the same SDK round.
        validatePageUpdates?.(numbers);
        const updates = input.replacePages.map((update) => {
          const preview = previews.find((image) => image.name === update.image);
          if (!preview)
            throw new AppError("Python 未返回替换页面的图像。", "PAGE_UPDATE_INVALID", 422);
          return { page: findPage(update.page), preview };
        });
        for (const { page, preview } of updates)
          Object.assign(page, {
            path: join(directory, preview.image),
            width: preview.width,
            height: preview.height,
          });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          images: previews.map((preview) => preview.image),
          previews,
          pages: updates.map(({ page, preview }) => ({
            page: page.page,
            width: page.width,
            height: page.height,
            image: preview.image,
          })),
        };
      },
      toModelOutput: ({ output }) => imageOutput(output),
    }),
  };
}
