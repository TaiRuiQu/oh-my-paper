import { expect, it } from "vitest";
import { randomFillSync } from "node:crypto";
import sharp from "sharp";
import { decodeUploadedPages } from "@/server/platform/uploaded-pages";
import { makeTextPdf } from "../scripts/pdf-test-fixtures";
import {
  prepareModelImage,
  prepareWorkbenchImage,
  MODEL_IMAGE_MAX_BYTES,
  MODEL_IMAGE_MAX_EDGE,
  WORKBENCH_IMAGE_MAX_BYTES,
  WORKBENCH_IMAGE_MAX_EDGE,
} from "@/server/platform/ai/images";

it("bounds high-entropy uploads and their model previews by bytes as well as dimensions", async () => {
  const input = await sharp(randomFillSync(Buffer.alloc(3000 * 2200 * 3)), {
    raw: { width: 3000, height: 2200, channels: 3 },
  })
    .png()
    .toBuffer();
  const workbench = await prepareWorkbenchImage(input);
  const preview = await prepareModelImage(workbench);
  for (const [buffer, maxBytes, maxEdge] of [
    [workbench, WORKBENCH_IMAGE_MAX_BYTES, WORKBENCH_IMAGE_MAX_EDGE],
    [preview, MODEL_IMAGE_MAX_BYTES, MODEL_IMAGE_MAX_EDGE],
  ] as const) {
    expect(buffer.length).toBeLessThanOrEqual(maxBytes);
    expect(buffer.length).toBeLessThan(input.length / 4);
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(maxEdge);
    expect(metadata.width! / metadata.height!).toBeCloseTo(3000 / 2200, 2);
  }
}, 20_000);

it("compresses rendered PDF pages while retaining colored content", async () => {
  const [page] = await decodeUploadedPages(makeTextPdf(1), "paper.pdf");
  const compressed = await prepareWorkbenchImage(page.buffer);
  const metadata = await sharp(compressed).metadata();
  expect(Math.max(metadata.width!, metadata.height!)).toBe(WORKBENCH_IMAGE_MAX_EDGE);
  expect(compressed.length).toBeLessThanOrEqual(WORKBENCH_IMAGE_MAX_BYTES);
  const { data } = await sharp(compressed).raw().toBuffer({ resolveWithObject: true });
  const pixel =
    (Math.floor(metadata.height! * 0.25) * metadata.width! + Math.floor(metadata.width! * 0.5)) * 3;
  expect(data[pixel]).toBeGreaterThan(230);
  expect(data[pixel + 2]).toBeLessThan(25);
}, 20_000);

it("corrects orientation, flattens transparency to white and never enlarges small inputs", async () => {
  const input = await sharp({
    create: { width: 80, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
  const compressed = await prepareWorkbenchImage(input);
  expect(await sharp(compressed).metadata()).toMatchObject({
    width: 40,
    height: 80,
    hasAlpha: false,
  });
  const { channels } = await sharp(compressed).stats();
  expect(channels.every((channel) => channel.min >= 250)).toBe(true);
});
