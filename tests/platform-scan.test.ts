import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  generateCardTemplate,
  defaultCardPresets,
  validateCardTemplate,
  choiceBubbles,
} from "../src/server/platform/cards";
import {
  renderCardHtml,
  renderCardSvg,
  renderPaperHtml,
  renderPrintRichText,
} from "../src/server/platform/print";
import { processCardScan, cropWorkbook } from "../src/server/platform/scan";
import type { Paper } from "../src/server/platform/types";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function paper(count = 3): Paper {
  return {
    id: "paper",
    ownerId: "teacher",
    name: "期中数学",
    kind: "EXAM",
    subject: "数学",
    grade: "高一",
    instructions: "认真作答",
    layout: { paperSize: "A4", columns: 1 },
    createdAt: "",
    updatedAt: "",
    items: Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      questionId: `q-${i}`,
      position: i,
      score: 10,
      section: "",
      snapshot: {
        id: `q-${i}`,
        ownerId: "teacher",
        type: i === 0 ? "SINGLE" : i === 1 ? "MULTIPLE" : "SUBJECTIVE",
        subject: "数学",
        grade: "高一",
        difficulty: 3,
        knowledgeTags: [],
        createdAt: "",
        updatedAt: "",
        content: {
          stem: "测试题目",
          options: i < 2 ? ["A", "B", "C", "D"].map((label) => ({ label, text: label })) : [],
          answers: [],
          explanation: "",
          rubric: "",
          parts: [],
          images: [],
        },
      },
    })),
  };
}
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "omp-scan-test-"));
  dirs.push(dir);
  return dir;
}
describe("answer cards and scans", () => {
  it("provides nine editable subject presets and complete paginated templates", () => {
    expect(defaultCardPresets()).toHaveLength(9);
    const p = paper(12),
      template = generateCardTemplate(p);
    expect(template.layout.pageCount).toBeGreaterThan(1);
    expect(template.layout.regions.map((r) => r.itemId)).toEqual(p.items.map((i) => i.id));
    const html = renderCardHtml(template);
    expect(html.match(/<svg/g)).toHaveLength(template.layout.pageCount);
    expect(html).toContain("六位学号");
    template.layout.regions[0].height = 0.01;
    expect(() => validateCardTemplate(template, p)).toThrow();
  });
  it("escapes printable content and rejects injected image URLs", () => {
    const p = paper();
    p.name = "<script>alert(1)</script>";
    expect(renderPaperHtml(p)).toContain("&lt;script&gt;");
    p.items[0].snapshot.content.images = ["javascript:alert(1)"];
    expect(() => renderCardSvg(generateCardTemplate(p))).toThrow();
    p.items[0].snapshot.content.images = [];
    p.items[0].snapshot.content.stem = "函数 $x^2$ 与 $$\\frac{1}{2}$$";
    p.items[0].snapshot.content.parts = [
      {
        id: "a",
        type: "SINGLE",
        stem: "子题 $x=1$",
        options: [
          { label: "A", text: "$x^3$" },
          { label: "B", text: "另一选项" },
        ],
        answers: ["A"],
        explanation: "",
        rubric: "",
        knowledgeTags: [],
        score: 3,
      },
    ];
    const printed = renderPaperHtml(p);
    expect(printed).toContain("<math");
    expect(printed).toContain("另一选项");
    expect(printed).toContain("（1）");
    expect(printed).not.toContain("（3 分）");
    expect(renderPrintRichText("<script>alert(1)</script> $x$")).not.toContain("<script>");
  });
  it("aligns a perspective photograph, reads six-digit ID and single/multiple marks, and crops answers", async () => {
    const dir = await directory(),
      template = generateCardTemplate(paper());
    const n = template.layout.studentNumber;
    const fills =
      Array.from(
        "012345",
        (value, column) =>
          `<circle cx="${(n.x + column * n.cellWidth) * 794}" cy="${(n.y + Number(value) * n.cellHeight) * 1123}" r="5" fill="black"/>`,
      ).join("") +
      choiceBubbles(template.layout.regions[0])
        .filter((b) => b.value === "B")
        .map((b) => `<circle cx="${b.x}" cy="${b.y}" r="7" fill="black"/>`)
        .join("") +
      choiceBubbles(template.layout.regions[1])
        .filter((b) => ["A", "C"].includes(b.value))
        .map((b) => `<circle cx="${b.x}" cy="${b.y}" r="7" fill="black"/>`)
        .join("");
    const svg = renderCardSvg(template).replace("</svg>", `${fills}</svg>`);
    const source = join(dir, "card.png");
    await sharp(Buffer.from(svg)).png().toFile(source);
    const photo = join(dir, "photo.png");
    await promisify(execFile)(resolve(".venv/bin/python"), [
      "-c",
      "import cv2,numpy as np,sys; im=cv2.imread(sys.argv[1]); h,w=im.shape[:2]; src=np.float32([[0,0],[w,0],[w,h],[0,h]]); dst=np.float32([[100,50],[890,120],[820,1250],[40,1160]]); out=cv2.warpPerspective(im,cv2.getPerspectiveTransform(src,dst),(1000,1300),borderValue=(255,255,255)); cv2.imwrite(sys.argv[2],out)",
      source,
      photo,
    ]);
    const result = await processCardScan({
      inputPath: photo,
      template,
      outputDir: join(dir, "out"),
    });
    expect(result.studentNumber).toBe("012345");
    expect(result.answers.map((a) => a.text)).toEqual(["B", "A,C", ""]);
    expect(result.alignment.corrected).toBe(true);
    expect(result.needsReview).toBe(false);
    for (const angle of [30, 90, 180]) {
      const rotated = join(dir, `rotation-${angle}.png`);
      await sharp(source).rotate(angle).png().toFile(rotated);
      const rescanned = await processCardScan({
        inputPath: rotated,
        template,
        outputDir: join(dir, `out-${angle}`),
      });
      expect(rescanned.studentNumber).toBe("012345");
      expect(rescanned.answers.map((answer) => answer.text)).toEqual(["B", "A,C", ""]);
    }
    const crop = await sharp(result.answers[2].images[0]).metadata();
    expect(crop.width).toBeGreaterThan(600);
  }, 20000);
  it("rejects missing registration marks and flags ambiguous student ID", async () => {
    const dir = await directory(),
      template = generateCardTemplate(paper()),
      source = join(dir, "blank.png");
    await sharp({ create: { width: 794, height: 1123, channels: 3, background: "white" } })
      .png()
      .toFile(source);
    await expect(
      processCardScan({ inputPath: source, template, outputDir: join(dir, "out") }),
    ).rejects.toThrow("REGISTRATION_MARKS_MISSING");
    await sharp(Buffer.from(renderCardSvg(template)))
      .png()
      .toFile(source);
    const result = await processCardScan({
      inputPath: source,
      template,
      outputDir: join(dir, "marked"),
    });
    expect(result.studentNumber).toBeNull();
    expect(result.needsReview).toBe(true);
  }, 20000);
  it("crops irregular workbook pages using teacher-specified coordinates", async () => {
    const dir = await directory(),
      source = join(dir, "workbook.png");
    await sharp({ create: { width: 1000, height: 800, channels: 3, background: "#eee" } })
      .png()
      .toFile(source);
    const result = await cropWorkbook({
      inputPath: source,
      regions: [{ itemId: "item-0", page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.4 }],
      outputDir: join(dir, "crop"),
    });
    const meta = await sharp(result.answers[0].images[0]).metadata();
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(320);
    expect(result.alignment.manual).toBe(true);
    await expect(
      cropWorkbook({
        inputPath: source,
        regions: [{ itemId: "item-0", page: 1, x: 0.9, y: 0, width: 0.5, height: 0.4 }],
        outputDir: join(dir, "invalid"),
      }),
    ).rejects.toThrow();
  });
});
