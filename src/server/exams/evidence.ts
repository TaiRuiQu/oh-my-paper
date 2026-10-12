import "server-only";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { tool } from "ai";
import { z } from "zod";
import type { SourceRegion } from "@/contracts/exams";
import type { PageImage } from "./documents";

export type StoredCrop = { region: SourceRegion; key: string; path: string };
export function validRegion(region: SourceRegion, allowedPages: number[]) {
  return (
    allowedPages.includes(region.page) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= 1.000001 &&
    region.y + region.height <= 1.000001
  );
}
export function containsRegion(outer: SourceRegion, inner: SourceRegion) {
  const tolerance = 0.002;
  return (
    outer.page === inner.page &&
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}
export async function cropRegion(
  pages: PageImage[],
  region: SourceRegion,
  outputDir: string,
  key: string,
): Promise<StoredCrop> {
  if (
    !validRegion(
      region,
      pages.map((p) => p.page),
    )
  )
    throw new Error("Invalid source region.");
  const page = pages.find((p) => p.page === region.page)!;
  const left = Math.min(page.width - 1, Math.floor(region.x * page.width));
  const top = Math.min(page.height - 1, Math.floor(region.y * page.height));
  const width = Math.min(
    page.width - left,
    Math.max(1, Math.ceil((region.x + region.width) * page.width - 1e-7) - left),
  );
  const height = Math.min(
    page.height - top,
    Math.max(1, Math.ceil((region.y + region.height) * page.height - 1e-7) - top),
  );
  const path = join(outputDir, key);
  await sharp(page.path).extract({ left, top, width, height }).png().toFile(path);
  // Use the actual pixel crop as the coordinate frame, avoiding rounding drift.
  return {
    key,
    path,
    region: {
      page: region.page,
      x: left / page.width,
      y: top / page.height,
      width: width / page.width,
      height: height / page.height,
    },
  };
}
// Agents can enlarge only the supplied crops. They cannot fetch full pages,
// neighbouring questions, answer keys, arbitrary files or network resources.
export function cropTools(crops: StoredCrop[]) {
  return {
    inspect_crop: tool({
      description:
        "Inspect a detail inside one supplied crop. Coordinates are relative to that crop, never to a full page.",
      inputSchema: z.object({
        crop: z.number().int().positive(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      }),
      execute: async ({ crop, x, y, width, height }) => {
        const source = crops[crop - 1];
        if (!source || x + width > 1 || y + height > 1)
          throw new Error("Detail must remain inside the authorized crop.");
        const info = await sharp(source.path).metadata();
        const left = Math.min(info.width! - 1, Math.floor(x * info.width!));
        const top = Math.min(info.height! - 1, Math.floor(y * info.height!));
        const data = await sharp(source.path)
          .extract({
            left,
            top,
            width: Math.max(1, Math.min(info.width! - left, Math.ceil(width * info.width!))),
            height: Math.max(1, Math.min(info.height! - top, Math.ceil(height * info.height!))),
          })
          .png()
          .toBuffer();
        return data.toString("base64");
      },
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [{ type: "file", mediaType: "image/png", data: { type: "data", data: output } }],
      }),
    }),
  };
}
export async function saveJSON(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
