import "server-only";
import sharp from "sharp";

export const WORKBENCH_IMAGE_MAX_EDGE = 2400;
export const WORKBENCH_IMAGE_MAX_BYTES = 1024 * 1024;
export const MODEL_IMAGE_MAX_EDGE = 1800;
export const MODEL_IMAGE_MAX_BYTES = 512 * 1024;

/** Bound both dimensions and encoded bytes; noisy scans can be large even after resizing. */
async function compressImage(input: Buffer, maxEdge: number, maxBytes: number) {
  const source = sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .flatten({ background: "white" });
  let edge = maxEdge;
  for (;;) {
    for (const quality of [85, 75, 65]) {
      const buffer = await source
        .clone()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        // Preserve colored text and diagram edges before reducing resolution further.
        .jpeg({ quality, chromaSubsampling: "4:4:4" })
        .toBuffer();
      if (buffer.length <= maxBytes) return buffer;
    }
    edge = Math.max(1, Math.floor(edge * 0.8));
  }
}

export function prepareWorkbenchImage(input: Buffer) {
  return compressImage(input, WORKBENCH_IMAGE_MAX_EDGE, WORKBENCH_IMAGE_MAX_BYTES);
}

export function prepareModelImage(input: Buffer) {
  return compressImage(input, MODEL_IMAGE_MAX_EDGE, MODEL_IMAGE_MAX_BYTES);
}
