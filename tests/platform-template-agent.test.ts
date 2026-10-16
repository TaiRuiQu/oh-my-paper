import { describe, expect, it, vi } from "vitest";
import { asSchema } from "ai";
import sharp from "sharp";
import type { BankQuestion, CardTemplate, Paper } from "@/contracts/platform";
import { generateCardTemplate } from "@/lib/cards";
import { renderCardSvg } from "@/lib/card-svg";
import { prepareModelImage } from "@/server/platform/ai/images";
import { createTemplateRenderer } from "@/server/platform/ai/template-renderer";

function fixture(count = 1, image?: string) {
  const question: BankQuestion = {
    id: "q",
    ownerId: "teacher",
    type: "SUBJECTIVE",
    subject: "语文",
    grade: "四年级",
    difficulty: 0.5,
    knowledgeTags: [],
    createdAt: "",
    updatedAt: "",
    content: {
      stem: "写一段话",
      options: [],
      answers: [],
      explanation: "",
      rubric: "",
      images: image ? [image] : [],
      parts: [],
    },
  };
  const paper: Paper = {
    id: "paper",
    ownerId: "teacher",
    name: "语文月考",
    kind: "EXAM",
    subject: "语文",
    grade: "四年级",
    instructions: "",
    layout: { paperSize: "A4", columns: 1 },
    createdAt: "",
    updatedAt: "",
    items: Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      questionId: "q",
      position: i,
      section: "作文",
      score: 20,
      snapshot: question,
    })),
  };
  const readAsset = vi.fn<(_: string) => Promise<Buffer>>();
  const renderer = createTemplateRenderer({
    paper,
    userId: "teacher",
    name: `${paper.name}答题卡`,
    ensureReadable: vi.fn(),
    readAsset,
  });
  const layout = generateCardTemplate(paper, { subjectiveHeight: 500 }).layout;
  const execute = async (candidate: CardTemplate["layout"], pages: number[]) => {
    const output = await renderer.tool.execute!(
      { layout: candidate, pages },
      { toolCallId: "render", messages: [], context: {} },
    );
    if (!("images" in output)) throw new Error("Unexpected streaming tool output");
    return output;
  };
  const preview = async (candidate: CardTemplate["layout"], pages: number[]) => {
    const output = await execute(candidate, pages);
    const modelOutput = await renderer.tool.toModelOutput!({
      input: { layout: candidate, pages },
      output,
      toolCallId: "render",
    });
    return { output, modelOutput };
  };
  return { paper, layout, renderer, readAsset, preview, execute };
}

describe("answer card agent visual preview", () => {
  it("renders real pixels with formal multi-page numbering and requires every final page", async () => {
    const { paper, layout, renderer, preview } = fixture(4);
    expect(layout.pageCount).toBe(4);
    const original = structuredClone(layout);
    const { output, modelOutput } = await preview(layout, [2, 1, 3]);
    expect(modelOutput.type).toBe("content");
    if (modelOutput.type !== "content") throw new Error("Missing image content");
    expect(modelOutput.value.filter((part) => part.type === "file")).toHaveLength(3);
    expect(modelOutput.value[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(modelOutput.value[0])).not.toContain(output.images[0].image);
    const expected = await prepareModelImage(
      await sharp(
        Buffer.from(
          renderCardSvg(
            {
              id: "draft-preview",
              ownerId: "teacher",
              paperId: paper.id,
              name: `${paper.name}答题卡`,
              subject: paper.subject,
              preset: false,
              layout,
            },
            2,
          ),
        ),
      )
        .png()
        .toBuffer(),
    );
    expect(Buffer.from(output.images[0].image, "base64")).toEqual(expected);
    expect(() => renderer.assertPreviewed(layout)).toThrow(/尚未预览：4/);
    await preview(layout, [4]);
    expect(() => renderer.assertPreviewed(layout)).not.toThrow();
    const changed = structuredClone(layout);
    changed.regions[0].label = "作文（不少于300字）";
    expect(() => renderer.assertPreviewed(changed)).toThrow(/尚未预览：1、2、3、4/);
    const reordered = { ...layout, height: layout.height, width: layout.width };
    expect(() => renderer.assertPreviewed(reordered)).not.toThrow();
    expect(layout).toEqual(original);
    await expect(preview(layout, [5])).rejects.toThrow(/页码不存在/);
  });

  it("counts previews only when images have been converted into model output", async () => {
    const { layout, renderer, execute } = fixture();
    await execute(layout, [1]);
    expect(() => renderer.assertPreviewed(layout)).toThrow(/尚未预览/);
  });

  it("inlines only authorized paper images and bounds returned JPEGs", async () => {
    const url = "/api/platform/assets/authorized";
    const { layout, readAsset, preview } = fixture(1, url);
    readAsset.mockResolvedValue(
      await sharp({ create: { width: 200, height: 100, channels: 3, background: "#dd1100" } })
        .png()
        .toBuffer(),
    );
    const { output } = await preview(layout, [1]);
    expect(readAsset).toHaveBeenCalledExactlyOnceWith(url);
    const buffer = Buffer.from(output.images[0].image, "base64");
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1800);
    expect(buffer.length).toBeLessThanOrEqual(512 * 1024);
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    let redPixels = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) redPixels++;
    expect(redPixels).toBeGreaterThan(100);
    for (const image of [
      "/api/platform/assets/other",
      "file:///etc/passwd",
      "https://example.com/x",
    ])
      await expect(
        preview({ ...layout, regions: [{ ...layout.regions[0], image }] }, [1]),
      ).rejects.toThrow(/当前试卷/);
    expect(readAsset).toHaveBeenCalledTimes(1);
  });

  it("keeps page batches bounded and refuses invalid geometry before rendering", async () => {
    const { renderer, layout, preview } = fixture();
    const schema = asSchema(renderer.tool.inputSchema);
    for (const pages of [[], [1, 2, 3, 4], [1, 1], [0], [101]]) {
      const result = await schema.validate!({ layout, pages });
      expect(result.success).toBe(false);
    }
    const invalid = structuredClone(layout);
    invalid.regions[0].y = 0;
    await expect(preview(invalid, [1])).rejects.toThrow();
  });
});
