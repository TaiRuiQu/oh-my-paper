import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import type { Paper } from "@/contracts/platform";
import { renderPaperWord } from "@/server/platform/word-export";

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
    questionLayouts: { q: { answerSpaceMm: 21, pageBreakBefore: true, spaceAfterMm: 9 } },
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
  it("creates a real editable DOCX with saved page geometry, equations, embedded images and blank answer space", async () => {
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
    expect(xml).toContain('w:sep="true"');
    expect(xml).toContain('w:space="340"');
    expect(xml).toContain('w:top="1134"');
    expect(styles).toContain('w:sz w:val="28"');
    expect(xml).toContain('w:line="480"');
    expect(xml).toContain("<w:pageBreakBefore");
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:sSup>");
    expect(xml).not.toContain("$\\frac");
    expect(xml).not.toContain("<w:pBdr>");
    expect(xml).toContain('w:line="1191" w:lineRule="exact"');
    expect(
      Object.keys(zip.files).some(
        (name) => name.startsWith("word/media/") && name.endsWith(".png"),
      ),
    ).toBe(true);
    expect(xml).not.toContain("参考答案不应出现在学生文档");
    expect(styles).toContain('w:eastAsia="SimSun"');
    const exam = await JSZip.loadAsync(await renderPaperWord({ ...paper, kind: "EXAM" }, image));
    expect(await exam.file("word/document.xml")!.async("string")).not.toContain("作答：");
  });
  it("reserves default blank space and preserves a teacher's local font in editable Word", async () => {
    const copy = {
      ...paper,
      layout: { paperSize: "A4" as const, columns: 2, fontFamily: "霞鹜文楷" },
    };
    const zip = await JSZip.loadAsync(await renderPaperWord(copy, image));
    const xml = await zip.file("word/document.xml")!.async("string");
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(xml).not.toContain("<w:pBdr>");
    expect(xml).not.toContain("作答：");
    expect(xml).toContain('w:line="1984" w:lineRule="exact"');
    expect(xml).toContain('w:top="680"');
    expect(xml).toContain('w:bottom="1134"');
    expect(styles).toContain('w:eastAsia="霞鹜文楷"');
  });
  it("fails instead of silently dropping inaccessible private images", async () => {
    await expect(
      renderPaperWord(paper, async () => {
        throw new Error("无权访问图片");
      }),
    ).rejects.toThrow("无权访问图片");
  });
  it("exports zero-height answer areas without an extra blank paragraph", async () => {
    const copy = {
      ...paper,
      layout: { ...paper.layout, questionLayouts: { q: { answerSpaceMm: 0 } } },
    };
    const zip = await JSZip.loadAsync(await renderPaperWord(copy, image));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).not.toContain('w:before="0" w:line="0"');
    expect(xml).not.toContain('w:line="1191"');
    expect(xml).not.toContain('w:line="1984"');
    expect(xml).not.toContain("<w:pBdr>");
  });
  it("uses two rows of two in Word when four choices cannot fit on one row", async () => {
    const item = paper.items[0];
    const copy: Paper = {
      ...paper,
      kind: "EXAM",
      layout: { paperSize: "A4", columns: 2 },
      items: [
        {
          ...item,
          snapshot: {
            ...item.snapshot,
            type: "SINGLE",
            content: {
              ...item.snapshot.content,
              images: [],
              options: ["abcdefgh", "ijklmnop", "qrstuvwx", "yzabcdef"].map((text, index) => ({
                label: String.fromCharCode(65 + index),
                text,
              })),
            },
          },
        },
      ],
    };
    const zip = await JSZip.loadAsync(await renderPaperWord(copy, image));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.match(/<w:tr>/g)).toHaveLength(2);
    expect(xml.match(/<w:tc>/g)).toHaveLength(4);
  });
  it("keeps the number beside the stem, omits type and score, and places short choices in a borderless row", async () => {
    const item = paper.items[0];
    const copy = {
      ...paper,
      layout: { paperSize: "A4" as const, columns: 2 },
      items: [
        {
          ...item,
          section: "单选题",
          snapshot: {
            ...item.snapshot,
            content: {
              ...item.snapshot.content,
              stem: "选择正确答案。",
              images: [],
              options: ["2", "$-2$", "0", "4"].map((text, index) => ({
                label: String.fromCharCode(65 + index),
                text,
              })),
            },
          },
        },
      ],
    };
    const zip = await JSZip.loadAsync(await renderPaperWord(copy, image));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("1. 选择正确答案。");
    expect(xml).not.toContain("单选题");
    expect(xml).not.toContain("10 分");
    expect(xml.match(/<w:tr>/g)).toHaveLength(1);
    expect(xml.match(/<w:tc>/g)).toHaveLength(4);
    expect(xml).toContain('w:val="none"');
    expect(xml).toContain("<m:oMath ");
  });
});
