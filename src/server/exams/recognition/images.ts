import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import type { SourceRegion } from "@/contracts/exams";
import { cropRegion } from "../evidence";
import type { PageImage } from "../documents";

export function createRecognitionImages(pages: PageImage[], outputDir: string) {
  const imageOutput = async (output: { images: string[] }) => ({
    type: "content" as const,
    value: [
      { type: "text" as const, text: JSON.stringify(output) },
      ...(await Promise.all(
        output.images.map(async (key) => ({
          type: "file" as const,
          mediaType: "image/jpeg",
          providerOptions: { openai: { imageDetail: "high" } },
          data: {
            type: "data" as const,
            data: (await sharp(join(outputDir, key)).jpeg({ quality: 90 }).toBuffer()).toString(
              "base64",
            ),
          },
        })),
      )),
    ],
  });
  async function reviewEvidence(records: { regions: SourceRegion[] }[]) {
    const images = [];
    const contextPages = [...new Set(records.flatMap((q) => q.regions.map((r) => r.page)))];
    for (const number of contextPages) {
      const page = pages.find((p) => p.page === number)!;
      const key = `agent/${randomUUID()}.png`;
      await sharp(page.path)
        .resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true })
        .png()
        .toFile(join(outputDir, key));
      images.push(key);
    }
    for (const record of records)
      for (const region of record.regions) {
        const key = `agent/${randomUUID()}.png`;
        await cropRegion(pages, region, outputDir, key);
        images.push(key);
      }
    return { contextPages, images };
  }
  return { imageOutput, reviewEvidence };
}
