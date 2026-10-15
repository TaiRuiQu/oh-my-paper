import "server-only";
import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import sharp from "sharp";
import type { CardTemplate, Paper } from "@/contracts/platform";
import { renderCardSvg } from "@/lib/card-svg";
import { validateCardTemplate } from "@/lib/cards";
import { AccessError, RequestError } from "@/server/http/errors";
import { templateInputSchema } from "../schemas";
import { prepareModelImage, prepareWorkbenchImage } from "./images";

export const TEMPLATE_INSTRUCTIONS =
  "你负责制作适合实际书写、打印和扫描切题的答题卡。先理解整卷题型、题序和分值，按需读取完整题干、答案、解析、评分标准及配图，尤其核对主观题、综合题、证明题和作文。根据预计解答步骤、书写行数、作图需要和作文篇幅逐题分配空间，不要只按题型或分值机械套用统一高度；generate_layout仅提供可编辑初稿。兼顾易读题号、合理栏宽、连续题序、分页和留白，避免挤压作答空间或无用空白页。综合题保留一个对应顶层itemId的完整区域，可用简洁标签或批注提示小问，按各小问实际作答量安排空间，不要虚构独立itemId或拆成多个区域。作文按实际字数需求选择横线或方格并核对容量；现有区域结构无法容纳时明确说明限制，不要声称已满足。保留四个定位点、六位考号区、页码编码和页眉页脚安全区，每道题恰有一个合法不重叠区域，不改题目内容，不在答题卡泄露答案。仅使用当前试卷已授权的题目配图。自主决定读取、计算和调整方式，但必须使用render_template查看最终布局每一页的正式渲染图片，逐页核对题号顺序、标签截断、文字配图遮挡、书写空间、换栏分页及扫描标记；每次最多预览3页，可分批调用。渲染是草稿预览，页码编码不代表已保存的正式模板。发现问题则修改布局并重新预览全部页面，确认后才propose_template；提交内容必须与已预览布局完全一致。";

type Layout = CardTemplate["layout"];
// Tool JSON may reorder object keys between calls. Arrays (notably region order) remain significant.
const fingerprint = (layout: Layout) =>
  createHash("sha256")
    .update(
      JSON.stringify(layout, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      ),
    )
    .digest("hex");

export function createTemplateRenderer(options: {
  paper: Paper;
  userId: string;
  name: string;
  ensureReadable: () => void;
  readAsset: (url: string) => Promise<Buffer>;
}) {
  const allowedImages = new Set(
    options.paper.items.flatMap((item) => item.snapshot.content.images),
  );
  // Keep only a few recent revisions; no preview files or assets are persisted.
  const previewed = new Map<string, Set<number>>();
  const templateFor = (layout: Layout): CardTemplate => ({
    id: "draft-preview",
    ownerId: options.userId,
    paperId: options.paper.id,
    name: options.name,
    subject: options.paper.subject,
    preset: false,
    layout,
  });
  const validate = (layout: Layout) => {
    options.ensureReadable();
    const template = validateCardTemplate(templateFor(layout), options.paper);
    if (layout.regions.some((region) => region.image && !allowedImages.has(region.image)))
      throw new AccessError(403, "答题卡只能使用当前试卷已有的配图。");
    return template;
  };
  return {
    tool: tool({
      description:
        "Render a candidate answer-card layout with the same SVG renderer used by the editor and printing. Returns actual JPEG pixels, not a path or layout JSON. Supply layout and 1–3 distinct page numbers (defaults to page 1). Preview every page of the final layout before propose_template; any layout change requires previewing all pages again. Only current-paper illustrations are allowed. This is read-only and persists no template or image assets. Draft page codes are not valid saved-template scan credentials.",
      inputSchema: z.object({
        layout: templateInputSchema.shape.layout,
        pages: z
          .array(z.number().int().min(1).max(100))
          .min(1)
          .max(3)
          .refine((pages) => new Set(pages).size === pages.length, "预览页码不能重复。")
          .default([1]),
      }),
      execute: async ({ layout, pages = [1] }, { abortSignal }) => {
        const template = validate(layout);
        if (pages.some((page) => page > layout.pageCount))
          throw new RequestError(422, "答题卡预览页码不存在。");
        const images: { page: number; image: string }[] = [];
        const embedded = new Map<string, string>();
        let embeddedBytes = 0;
        for (const page of pages) {
          abortSignal?.throwIfAborted();
          const regions = [];
          for (const region of layout.regions) {
            if (region.page !== page) {
              // Keep the full list: the shared renderer derives printed numbers from its order.
              regions.push(region);
              continue;
            }
            if (region.image && !embedded.has(region.image)) {
              const buffer = await options.readAsset(region.image);
              abortSignal?.throwIfAborted();
              embedded.set(
                region.image,
                `data:image/jpeg;base64,${(await prepareWorkbenchImage(buffer)).toString("base64")}`,
              );
            }
            if (region.image) {
              embeddedBytes += embedded.get(region.image)!.length;
              if (embeddedBytes > 16 * 1024 * 1024)
                throw new RequestError(413, "预览配图总量过大，请减少本次预览页数或版面配图。");
            }
            regions.push({
              ...region,
              ...(region.image ? { image: embedded.get(region.image)! } : {}),
            });
          }
          // Embed authorized assets locally: librsvg never fetches URLs or reads host paths.
          const svg = renderCardSvg({ ...template, layout: { ...layout, regions } }, page, false);
          const raster = await sharp(Buffer.from(svg), { limitInputPixels: 50_000_000 })
            .png()
            .toBuffer();
          images.push({ page, image: (await prepareModelImage(raster)).toString("base64") });
        }
        options.ensureReadable();
        abortSignal?.throwIfAborted();
        return { layoutFingerprint: fingerprint(layout), pageCount: layout.pageCount, images };
      },
      toModelOutput: ({ output }) => {
        const pages = previewed.get(output.layoutFingerprint) ?? new Set<number>();
        output.images.forEach((image) => pages.add(image.page));
        previewed.delete(output.layoutFingerprint);
        previewed.set(output.layoutFingerprint, pages);
        if (previewed.size > 4) previewed.delete(previewed.keys().next().value!);
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: JSON.stringify({
                draftOnly: true,
                pageCount: output.pageCount,
                pages: output.images.map((image) => image.page),
                note: "以下图片依次对应pages；请核对实际版面。草稿页码编码不用于正式扫描。",
              }),
            },
            ...output.images.map((image) => ({
              type: "file" as const,
              mediaType: "image/jpeg",
              data: { type: "data" as const, data: image.image },
            })),
          ],
        };
      },
    }),
    assertPreviewed(layout: Layout) {
      validate(layout);
      const pages = previewed.get(fingerprint(layout));
      const missing = Array.from({ length: layout.pageCount }, (_, i) => i + 1).filter(
        (page) => !pages?.has(page),
      );
      if (missing.length)
        throw new RequestError(
          409,
          `请先使用render_template查看当前布局的全部页面；尚未预览：${missing.join("、")}。布局修改后须重新预览。`,
        );
    },
  };
}
