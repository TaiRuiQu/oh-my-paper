import "server-only";
import sharp from "sharp";
import type { SourceRegion } from "@/contracts/exams";
import type { PageImage } from "./documents";

// Anchor simple line geometry to actual pixels. Numeric vision boxes can clip vertices
// even when transcription is correct. Connected strokes provide a deterministic anchor;
// this is restricted to geometry, not multi-panel photos or chemical structures.
export async function anchorGeometryRegion(page: PageImage, proposed: SourceRegion): Promise<SourceRegion | null> {
  const left = Math.max(0, Math.floor((proposed.x - 0.08) * page.width));
  const top = Math.max(0, Math.floor((proposed.y - 0.10) * page.height));
  const right = Math.min(page.width, Math.ceil((proposed.x + proposed.width + 0.08) * page.width));
  const bottom = Math.min(page.height, Math.ceil((proposed.y + proposed.height + 0.10) * page.height));
  if (right <= left || bottom <= top) return null;
  const { data, info } = await sharp(page.path).extract({ left, top, width: right - left, height: bottom - top })
    .grayscale().raw().toBuffer({ resolveWithObject: true });
  const visited = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  let best: { x: number; y: number; width: number; height: number; score: number } | undefined;
  for (let start = 0; start < data.length; start++) {
    if (visited[start] || data[start] > 155) continue;
    let head = 0, tail = 1;
    queue[0] = start; visited[start] = 1;
    let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
    while (head < tail) {
      const pixel = queue[head++], x = pixel % info.width, y = Math.floor(pixel / info.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= info.width || ny < 0 || ny >= info.height) continue;
        const next = ny * info.width + nx;
        if (!visited[next] && data[next] <= 155) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    const width = maxX - minX + 1, height = maxY - minY + 1;
    if (width < page.width * 0.04 || height < page.height * 0.018 ||
      minX === 0 || minY === 0 || maxX === info.width - 1 || maxY === info.height - 1) continue;
    const score = width * height * Math.sqrt(tail);
    if (!best || score > best.score) best = { x: minX, y: minY, width, height, score };
  }
  if (!best) return null;
  const padding = Math.ceil(Math.min(page.width, page.height) * 0.018);
  const x = Math.max(0, left + best.x - padding), y = Math.max(0, top + best.y - padding);
  const x2 = Math.min(page.width, left + best.x + best.width + padding);
  const y2 = Math.min(page.height, top + best.y + best.height + padding);
  return { page: page.page, x: x / page.width, y: y / page.height,
    width: (x2 - x) / page.width, height: (y2 - y) / page.height };
}
