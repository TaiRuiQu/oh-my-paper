import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { prepareDocuments, DEFAULT_LIMITS } from "@/server/exams/documents";

describe("document preparation with scanning", () => {
  it("preserves a native high-resolution scan and its material coordinate space", async () => {
    const root = await mkdtemp(join(tmpdir(), "document-scan-"));
    try {
      const input = join(root, "large.png");
      await sharp({ create: { width: 4800, height: 3200, channels: 3, background: "white" } })
        .png()
        .toFile(input);
      const [page] = await prepareDocuments([input], root, DEFAULT_LIMITS);
      expect(page.width).toBe(4800);
      expect(page.height).toBe(3200);
      const metadata = JSON.parse(await readFile(`${page.path}.scan.json`, "utf8"));
      expect(metadata).toMatchObject({
        originalWidth: 4800,
        originalHeight: 3200,
        corrected: false,
        reason: "flat_scan",
      });
      expect((await sharp(page.path).metadata()).width).toBe(4800);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("applies EXIF orientation before deciding corners and original-resolution dimensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "document-exif-"));
    try {
      const input = join(root, "rotated.jpg");
      await sharp({ create: { width: 1600, height: 2400, channels: 3, background: "white" } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toFile(input);
      const [page] = await prepareDocuments([input], root, DEFAULT_LIMITS);
      expect(page.width).toBe(2400);
      expect(page.height).toBe(1600);
      const metadata = JSON.parse(await readFile(`${page.path}.scan.json`, "utf8"));
      expect(metadata.originalWidth).toBe(2400);
      expect(metadata.originalHeight).toBe(1600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
