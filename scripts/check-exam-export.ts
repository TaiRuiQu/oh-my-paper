import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import sharp from "sharp";
import type { Exam } from "@/contracts/exams";
import { buildExportDocument } from "@/server/exams/export/document";
import { withExportPage, formulaImages } from "@/server/exams/export/browser";
import { exportWord } from "@/server/exams/export/word";
const execute = promisify(execFile);
async function main() {
  const directory = resolve(process.argv[2] ?? "tmp/exam-export-check");
  await mkdir(join(directory, "materials"), { recursive: true });
  const picture = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><rect width="600" height="180" fill="white"/><path d="M70 140L300 25L530 140Z" fill="none" stroke="black" stroke-width="3"/><text x="288" y="20" font-size="20">A</text><text x="48" y="160" font-size="20">B</text><text x="535" y="160" font-size="20">C</text></svg>',
    ),
  )
    .jpeg()
    .toBuffer();
  const box = { page: 1, x: 0, y: 0, width: 1, height: 1 };
  const exam: Exam = {
    id: "validation",
    name: "试卷导出验证（测试数据）",
    totalScore: 100,
    sections: [
      {
        id: "section",
        number: "一",
        title: "计算与解答",
        description: "请认真阅读各题，并写出完整计算过程。",
        score: 100,
        questions: Array.from({ length: 20 }, (_, index) => ({
          id: `q-${index}`,
          number: index + 1,
          score: 5,
          description: String.raw`计算 **分式** \(\frac{x_1+1}{2}\)，并说明过程。

$$
\int_0^1 x^2\,dx=\frac{1}{3}
$$

| 项目 | 数值 |
| --- | --- |
| 半径 | $r=3$ |
| 面积 | $S=\pi r^2$ |`,
          materials: [box],
          subquestions: [
            { number: "(1)", description: "结合配图说明计算过程。", score: 2, materials: [] },
            { number: "(2)", description: "求值 $x^2+1$。", score: 3, materials: [] },
          ],
        })),
      },
    ],
  };
  for (let index = 1; index <= 20; index++)
    await writeFile(join(directory, `materials/${index}-1.jpg`), picture);
  const document = await buildExportDocument(exam, directory);
  await withExportPage(document, undefined, async (page) => {
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
    await writeFile(join(directory, "exam.pdf"), pdf);
    const formulas = await formulaImages(page, document);
    assert.equal(formulas.size, document.formulas.size);
    for (const item of formulas.values()) {
      const info = await sharp(item.data).metadata();
      assert.equal(info.format, "png");
      assert.ok(info.width! >= Math.floor(item.width * 2));
    }
    const word = await exportWord(document, formulas);
    await writeFile(join(directory, "exam.docx"), word);
    const zip = await JSZip.loadAsync(word),
      xml = await zip.file("word/document.xml")!.async("string");
    assert.ok(xml.includes("第 20 题"));
    assert.ok(xml.includes("<w:tbl>"));
    assert.ok(xml.includes("<w:t"));
    assert.equal(xml.includes("<m:oMath"), false);
    assert.equal(xml.includes("altChunk"), false);
    assert.ok(xml.includes('title="数学公式"'));
    assert.ok(xml.includes('title="试卷配图"'));
    const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
    assert.ok(
      paragraphs.some(
        (paragraph) => paragraph.includes("(1)") && paragraph.includes("结合配图说明计算过程"),
      ),
    );
    assert.ok(
      paragraphs.some(
        (paragraph) =>
          paragraph.includes("(2)") &&
          paragraph.includes("求值") &&
          paragraph.includes("<w:drawing>"),
      ),
    );
    console.log(
      `✓ Editable Word text/tables/materials and ${formulas.size} reusable PNG formula images`,
    );
  });
  const { stdout } = await execute(process.env.PDFINFO_PATH ?? "pdfinfo", [
    join(directory, "exam.pdf"),
  ]);
  const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  assert.ok(pages > 1);
  assert.ok(stdout.includes("(A4)"));
  await execute(process.env.PDFTOTEXT_PATH ?? "pdftotext", [
    join(directory, "exam.pdf"),
    join(directory, "exam.txt"),
  ]);
  const text = await readFile(join(directory, "exam.txt"), "utf8");
  assert.ok(text.includes("试卷导出验证"));
  assert.ok(text.includes("第 20 题"));
  assert.ok(text.includes("写出完整计算过程"));
  assert.match(text, /\(1\)（2 分）[^\S\r\n]*结合配图说明计算过程。/);
  assert.match(text, /\(2\)（3 分）[^\S\r\n]*求值/);
  console.log(`✓ A4 PDF with ${pages} pages and searchable Chinese text`);
  console.log(`Export verification files: ${directory}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
