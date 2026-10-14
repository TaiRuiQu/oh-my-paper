import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import type { Paper } from "@/contracts/platform";
import { renderPaperWord } from "@/server/platform/word-export";
import { renderPaperHtml } from "@/server/platform/print";
import { renderPdf } from "@/server/platform/pdf-export";

const paper: Paper = {
  id: "paper",
  ownerId: "teacher",
  name: "函数练习",
  kind: "HOMEWORK",
  subject: "数学",
  grade: "高中一年级",
  instructions: "独立完成",
  createdAt: "",
  updatedAt: "",
  layout: {
    paperSize: "A3",
    orientation: "landscape",
    columns: 2,
    marginMm: 20,
    fontSizePt: 14,
    lineHeight: 2,
    fontFamily: "SimSun",
    textBlocks: [{ id: "text", text: "第一部分", beforeQuestionId: "q" }],
    questionLayouts: { q: { answerLines: 3, pageBreakBefore: true, spaceAfterMm: 9 } },
  },
  items: [
    {
      id: "item",
      questionId: "q",
      position: 0,
      score: 10,
      section: "函数",
      snapshot: {
        id: "q",
        ownerId: "teacher",
        subject: "数学",
        grade: "高中一年级",
        type: "SUBJECTIVE",
        difficulty: 0.5,
        knowledgeTags: ["函数"],
        createdAt: "",
        updatedAt: "",
        content: {
          stem: "计算 $\\frac{x^2}{2}$。\n说明理由。",
          options: [],
          answers: ["参考答案不应出现在学生文档"],
          explanation: "",
          rubric: "",
          parts: [],
          images: ["/api/platform/assets/image"],
        },
      },
    },
  ],
};
async function image() {
  return {
    buffer: await sharp({ create: { width: 100, height: 60, channels: 3, background: "#2459d3" } })
      .png()
      .toBuffer(),
    contentType: "image/png",
  };
}
describe("downloadable teaching documents", () => {
  it("creates a real editable DOCX with saved page geometry, equations, embedded images and answer lines", async () => {
    const result = await renderPaperWord(paper, image);
    expect(result.subarray(0, 2).toString()).toBe("PK");
    const zip = await JSZip.loadAsync(result);
    const xml = await zip.file("word/document.xml")!.async("string");
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(xml).toContain("函数练习");
    expect(xml.indexOf("第一部分")).toBeLessThan(xml.indexOf("计算"));
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('w:w="23811"');
    expect(xml).toContain('w:num="2"');
    expect(xml).toContain('w:top="1134"');
    expect(styles).toContain('w:sz w:val="28"');
    expect(xml).toContain('w:line="480"');
    expect(xml).toContain("<w:pageBreakBefore");
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:sSup>");
    expect(xml).not.toContain("$\\frac");
    expect(xml.match(/<w:pBdr>/g)).toHaveLength(3);
    expect(
      Object.keys(zip.files).some(
        (name) => name.startsWith("word/media/") && name.endsWith(".png"),
      ),
    ).toBe(true);
    expect(xml).not.toContain("参考答案不应出现在学生文档");
    const exam = await JSZip.loadAsync(await renderPaperWord({ ...paper, kind: "EXAM" }, image));
    expect(await exam.file("word/document.xml")!.async("string")).not.toContain("作答：");
  });
  it("fails instead of silently dropping inaccessible private images", async () => {
    await expect(
      renderPaperWord(paper, async () => {
        throw new Error("无权访问图片");
      }),
    ).rejects.toThrow("无权访问图片");
  });
  it.runIf(process.env.TEST_PDF_EXPORT === "1")(
    "renders real PDF bytes through Chromium using saved layout and private images",
    async () => {
      const bytes = await renderPdf(renderPaperHtml(paper), image);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1000);
    },
    60000,
  );
});
