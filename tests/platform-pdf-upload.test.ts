import { expect, it } from "vitest";
import sharp from "sharp";
import { makeTextPdf } from "../scripts/pdf-test-fixtures";
import { decodeUploadedPages } from "@/server/platform/uploaded-pages";
import { saveImage } from "@/server/platform/assets";
import { appendScanPages } from "@/lib/document-upload";
it("expands a real PDF into ordered high-resolution PNG pages", async () => {
  const pages = await decodeUploadedPages(makeTextPdf(), "扫描材料.pdf");
  expect(pages.map((page) => page.page)).toEqual([1, 2]);
  for (const [index, page] of pages.entries()) {
    expect(page.name).toContain(`第 ${index + 1} 页`);
    const metadata = await sharp(page.buffer).metadata();
    expect(metadata.format).toBe("png");
    expect(Math.max(metadata.width!, metadata.height!)).toBe(3508);
    const { data } = await sharp(page.buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel =
      (Math.floor(metadata.height! * 0.25) * metadata.width! + Math.floor(metadata.width! * 0.5)) *
      3;
    expect(data[pixel + (index ? 2 : 0)]).toBeGreaterThan(240);
    expect(data[pixel + (index ? 0 : 2)]).toBeLessThan(15);
  }
}, 20000);
it("accepts existing image inputs and rejects empty, malformed, overlarge or excessive PDFs", async () => {
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  expect((await decodeUploadedPages(png, "扫描.png")).length).toBe(1);
  await expect(decodeUploadedPages(Buffer.alloc(0), "empty.pdf")).rejects.toThrow("文件为空");
  await expect(decodeUploadedPages(Buffer.from("%PDF-1.7\nbroken"), "broken.pdf")).rejects.toThrow(
    "PDF 无法读取",
  );
  await expect(decodeUploadedPages(png, "fake.pdf")).rejects.toThrow("PDF 无法读取");
  await expect(decodeUploadedPages(makeTextPdf(101), "长扫描.pdf")).rejects.toThrow(
    "最多处理 100 页",
  );
  await expect(decodeUploadedPages(makeTextPdf(2), "两页.pdf", 1)).rejects.toThrow("最多处理 1 页");
  await expect(decodeUploadedPages(Buffer.alloc(30_000_001), "large.pdf")).rejects.toThrow("30 MB");
});
it("keeps decorative image uploads image-only", async () => {
  await expect(saveImage("teacher", makeTextPdf(), "配图.pdf")).rejects.toThrow("配图只支持");
});
it("preserves mixed prepared PDF pages and raw image order without re-uploading the PDF assets", () => {
  const image = new File(["image"], "扫描.png", { type: "image/png" }),
    form = new FormData();
  appendScanPages(form, [
    { name: "PDF page 1", size: 5, assetUrl: "/api/platform/assets/page1" },
    image,
    { name: "PDF page 2", size: 5, assetUrl: "/api/platform/assets/page2" },
  ]);
  expect(JSON.parse(String(form.get("sources")))).toEqual([
    { assetUrl: "/api/platform/assets/page1" },
    { fileIndex: 0 },
    { assetUrl: "/api/platform/assets/page2" },
  ]);
  expect(form.getAll("files")).toHaveLength(1);
});
