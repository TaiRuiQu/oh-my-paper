import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { parseExam, materialPixels } from "@/server/exams/parser";
import type { ParsedExam } from "@/contracts/exams";
import type { ExamModel } from "@/server/ai/providers";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function input() {
  const root = await mkdtemp(join(tmpdir(), "minimal-exam-"));
  roots.push(root);
  const files = [join(root, "first.png"), join(root, "second.png")];
  for (const path of files)
    await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } })
      .png()
      .toFile(path);
  return { root, files };
}
const exam: ParsedExam = {
  name: "跨页试卷",
  totalScore: null,
  sections: [
    {
      number: "一",
      title: "阅读题",
      description: "",
      score: null,
      questions: [
        {
          number: 15,
          description: "阅读材料，完成下列小问。",
          score: null,
          materials: [{ page: 2, x: 0.1, y: 0.2, width: 0.5, height: 0.3 }],
          subquestions: [
            { number: "(1)", description: "概括第一段。", materials: [], score: null },
            {
              number: "(2)",
              description: "解释下图。",
              materials: [{ page: 1, x: 0.2, y: 0.3, width: 0.3, height: 0.2 }],
              score: null,
            },
          ],
        },
      ],
    },
  ],
};
describe("paper parsing", () => {
  it("sends all pages once and persists only the minimal output with usable material crops", async () => {
    const { root, files } = await input(),
      outputDir = join(root, "result");
    const generate = vi.fn().mockResolvedValue(exam);
    const output = await parseExam({ files, outputDir, model: { generate } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      generate.mock.calls[0][0].content.filter((part: { type: string }) => part.type === "file"),
    ).toHaveLength(2);
    expect(output).toEqual(exam);
    expect(JSON.parse(await readFile(join(outputDir, "exam.json"), "utf8"))).toEqual(exam);
    const metadata = await sharp(join(outputDir, "materials/1-1.jpg")).metadata();
    expect(metadata.width).toBe(50);
    expect(metadata.height).toBe(60);
    const part = await sharp(join(outputDir, "materials/1-2-1.jpg")).metadata();
    expect(part.width).toBe(30);
    expect(part.height).toBe(40);
  });
  it("fails the parse instead of publishing a result with a missing material page", async () => {
    const { root, files } = await input();
    await expect(
      parseExam({
        files,
        outputDir: join(root, "result"),
        model: {
          generate: async () => ({
            ...exam,
            sections: [
              {
                ...exam.sections[0],
                questions: [
                  {
                    ...exam.sections[0].questions[0],
                    materials: [{ ...exam.sections[0].questions[0].materials[0], page: 3 }],
                  },
                ],
              },
            ],
          }),
        },
      }),
    ).rejects.toThrow("missing page");
    await expect(readFile(join(root, "result/exam.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("does not overwrite an existing parse directory", async () => {
    const { root, files } = await input(),
      outputDir = join(root, "result");
    await mkdir(outputDir);
    const generate = vi.fn().mockResolvedValue(exam);
    await expect(parseExam({ files, outputDir, model: { generate } })).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it("saves each batch before recognition finishes and keeps the last valid draft on failure", async () => {
    const { root, files } = await input(),
      outputDir = join(root, "result");
    const generate: ExamModel["generate"] = async ({ onProgress }) => {
      await onProgress!(exam);
      expect(JSON.parse(await readFile(join(outputDir, "draft.json"), "utf8"))).toEqual(exam);
      const expanded = structuredClone(exam);
      expanded.sections[0].questions.push({
        ...exam.sections[0].questions[0],
        number: 16,
      });
      await onProgress!(expanded);
      expect(JSON.parse(await readFile(join(outputDir, "draft.json"), "utf8"))).toEqual(expanded);
      const invalid = structuredClone(expanded);
      invalid.sections[0].questions[0].materials[0].page = 3;
      await expect(onProgress!(invalid)).rejects.toThrow("missing page");
      expect(JSON.parse(await readFile(join(outputDir, "draft.json"), "utf8"))).toEqual(expanded);
      throw new Error("Recognition interrupted");
    };
    await expect(parseExam({ files, outputDir, model: { generate } })).rejects.toThrow(
      "Recognition interrupted",
    );
    expect(JSON.parse(await readFile(join(outputDir, "draft.json"), "utf8"))).toMatchObject({
      sections: [{ questions: [{ number: 15 }, { number: 16 }] }],
    });
    await expect(readFile(join(outputDir, "exam.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("publishes accumulated questions and crops on success, then removes the draft", async () => {
    const { root, files } = await input(),
      outputDir = join(root, "result");
    const generate: ExamModel["generate"] = async ({ onProgress }) => {
      await onProgress!(exam);
      return exam;
    };
    expect(await parseExam({ files, outputDir, model: { generate } })).toEqual(exam);
    expect(JSON.parse(await readFile(join(outputDir, "exam.json"), "utf8"))).toEqual(exam);
    await expect(readFile(join(outputDir, "draft.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await sharp(join(outputDir, "materials/1-1.jpg")).metadata()).width).toBe(50);
  });
  it("rounds boxes outward without exceeding edge pixels", () => {
    expect(
      materialPixels(
        { page: 1, x: 0.999, y: 0.999, width: 0.001, height: 0.001 },
        { width: 100, height: 200 },
      ),
    ).toEqual({ left: 99, top: 199, width: 1, height: 1 });
  });
});
