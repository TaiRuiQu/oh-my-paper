import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import type { Exam } from "@/contracts/exams";
import { examExportFilename } from "@/contracts/exam-exports";
import {
  buildExportDocument,
  resolveDocumentImage,
  splitChoices,
  printLayout,
} from "@/server/exams/export/document";
import { exportHtml } from "@/server/exams/export/html";
import { exportWord } from "@/server/exams/export/word";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const box = { page: 1, x: 0, y: 0, width: 1, height: 1 };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "exam-export-test-"));
  roots.push(directory);
  await mkdir(join(directory, "materials"));
  const picture = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  await sharp(picture).toFile(join(directory, "materials/1-1.jpg"));
  await sharp(picture).toFile(join(directory, "materials/1-1-1.jpg"));
  const exam: Exam = {
    id: "exam",
    name: "数学 <script>试卷",
    totalScore: null,
    sections: [
      {
        id: "section",
        number: "一",
        title: "计算题",
        description: "公共说明，**认真阅读**。",
        score: 10,
        questions: [
          {
            id: "question",
            number: 15,
            description: String.raw`求 $x^2$ 和 \(\frac{1}{2}\)。

$$
a^2+b^2=c^2
$$

| 项目 | 内容 |
| --- | --- |
| 数值 | $x^2$ |

<img src="https://example.invalid/track" onerror="alert(1)">

![外部图片](https://example.invalid/track)

[恶意链接](javascript:alert(1))

\`$not_math$\``,
            score: null,
            materials: [box],
            subquestions: [
              { number: "(1)", description: "1. 第一步\n2. 第二步", score: 5, materials: [box] },
              {
                number: "(2)",
                description: "计算 **面积** $S=ab$。\n\n写出计算过程。",
                score: null,
                materials: [],
              },
            ],
          },
        ],
      },
    ],
  };
  // Template backticks must be literal Markdown code rather than backslash escapes.
  exam.sections[0].questions[0].description = exam.sections[0].questions[0].description.replaceAll(
    "\\`",
    "`",
  );
  return { exam, directory, picture };
}
describe("printable PDF source and editable Word documents", () => {
  it.each(["A3", "A4"] as const)(
    "uses %s and all four column counts in both export formats",
    async (paperSize) => {
      const { exam, directory } = await fixture();
      for (const columns of [1, 2, 3, 4]) {
        exam.layout = { paperSize, columns };
        const document = await buildExportDocument(exam, directory);
        const layout = printLayout(exam.layout);
        const html = await exportHtml(document);
        expect(html).toContain(`@page{size:${layout.widthMm}mm ${layout.heightMm}mm;margin:10mm}`);
        expect(html).toContain(`grid-template-columns:repeat(${columns},minmax(0,1fr))`);
        const zip = await JSZip.loadAsync(await exportWord(document));
        const xml = await zip.file("word/document.xml")!.async("string");
        expect(xml).toContain(`w:num="${columns}"`);
        const twips = (mm: number) => Math.round((mm * 1440) / 25.4);
        expect(xml).toContain(`w:w="${twips(layout.widthMm)}" w:h="${twips(layout.heightMm)}"`);
      }
    },
  );
  it("preserves hierarchy, scores and pictures while using the existing math syntax", async () => {
    const { exam, directory } = await fixture();
    const document = await buildExportDocument(exam, directory, undefined, "task");
    expect(
      document.parts.filter((part) => part.kind === "heading").map((part) => part.text),
    ).toEqual(["数学 <script>试卷"]);
    expect(document.images.size).toBe(2);
    expect(Array.from(document.formulas.values()).map((formula) => formula.latex)).toEqual([
      "x^2",
      String.raw`\frac{1}{2}`,
      "a^2+b^2=c^2",
      "S=ab",
    ]);
    expect(resolveDocumentImage(document, "/api/exams/task/files/materials/1-1.jpg")).toBeDefined();
    expect(
      resolveDocumentImage(document, "/api/exams/other/files/materials/1-1.jpg"),
    ).toBeUndefined();
    expect(resolveDocumentImage(document, "../../.env")).toBeUndefined();
    const html = await exportHtml(document);
    expect(html).toContain("@page{size:210mm 297mm;margin:10mm}");
    expect(html).toContain("grid-template-columns:repeat(1,minmax(0,1fr))");
    expect(html).toContain("<strong>15.</strong> 求");
    expect(html).toContain("一、计算题（10 分）：");
    expect(html).not.toContain("第 15 题</h3>");
    expect(html).toContain("<table>");
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).toContain('font-family:"NSimSun";src:url("data:font/ttf;base64,');
    expect(html).toContain('font:11pt/1.45 "NSimSun",');
    expect(html).toContain("<strong>认真阅读</strong>");
    expect(html).not.toContain('<img src="https:');
    expect(html).not.toContain('<a href="javascript:');
    expect(html).not.toContain("<script>");
    expect(html).toContain("<code>$not_math$</code>");
    expect(html).toContain("<p><strong>(2)</strong> 计算 <strong>面积</strong>");
    expect(html).toContain("<p>写出计算过程。</p>");
    expect(html).not.toContain("<h4>");
  });
  it("stores editable paragraphs, tables and native Office Math, with drawings only for materials", async () => {
    const { exam, directory } = await fixture();
    const document = await buildExportDocument(exam, directory);
    const data = await exportWord(document),
      zip = await JSZip.loadAsync(data);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("15.");
    expect(xml).toContain('w:orient="portrait"');
    expect(xml).toContain('w:num="1"');
    expect(xml).toContain('w:w="11906" w:h="16838"');
    expect(xml).toContain("第二步");
    expect(xml).toContain("<w:t");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:drawing>");
    expect(xml).not.toContain('title="数学公式"');
    expect(xml.match(/<m:oMath[ >]/g)).toHaveLength(5);
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:sSup>");
    expect(xml).not.toContain("<undefined>");
    expect(xml).not.toContain("altChunk");
    expect(xml).not.toContain("javascript:");
    const subquestion = xml
      .match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
      .find((paragraph) => paragraph.includes("(2)"));
    expect(subquestion).toContain("计算 ");
    expect(subquestion).toContain("面积");
    expect(subquestion).toContain("<m:oMath");
    expect(xml.match(/<w:drawing>/g)).toHaveLength(2);
    expect(
      Object.keys(zip.files).filter(
        (name) => name.startsWith("word/media/") && name.endsWith(".png"),
      ).length,
    ).toBe(0);
  });
  it("uses safe Unicode download names and honors cancellation before reading files", async () => {
    expect(examExportFilename(' ../数学试卷\r\n"\\?* ', "pdf")).toBe(".. 数学试卷.pdf");
    expect(examExportFilename("\n\t", "docx")).toBe("试卷.docx");
    const { exam, directory } = await fixture();
    await expect(buildExportDocument(exam, directory, AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  it("recognizes four options without splitting mathematical variable names", () => {
    expect(splitChoices("选择正确答案。\nA. $x=1$\nB. $x=2$\nC. $x=3$\nD. $x=4$")).toEqual({
      stem: "选择正确答案。",
      choices: ["A. $x=1$", "B. $x=2$", "C. $x=3$", "D. $x=4$"],
    });
    expect(splitChoices("已知点 A、B、C，求面积。").choices).toEqual([]);
  });
});
