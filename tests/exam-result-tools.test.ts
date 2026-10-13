import { describe, expect, it, vi } from "vitest";
import type { ParsedExam } from "@/contracts/exams";
import { createResultTools } from "@/server/exams/result-tools";

const options = { toolCallId: "test", messages: [], context: {} };
function batch(numbers: number[], section = "一"): ParsedExam {
  return {
    name: "数学试卷",
    totalScore: null,
    layout: { paperSize: "A4", columns: 1, orientation: "portrait" },
    sections: [
      {
        number: section,
        title: "选择题",
        description: "每小题 5 分。",
        score: null,
        questions: numbers.map((number) => ({
          number,
          description: `第 ${number} 题正文`,
          materials: [],
          score: 5,
          subquestions: [],
        })),
      },
    ],
  };
}

describe("incremental recognition results", () => {
  it("accepts workbook excerpts with unknown counts, missing scores and restarted numbering, retaining corrected layout", async () => {
    const progress = vi.fn(async () => {}),
      update = vi.fn(async () => {});
    const state = createResultTools(progress, update);
    await state.tools.report_exam_meta.execute!(
      { total: null, paperSize: "A3", columns: 2 },
      options,
    );
    const first = batch([15, 18]);
    first.sections[0].description = "课时练习，照片仅包含部分页。";
    first.sections[0].questions.forEach((question) => {
      question.score = null;
    });
    await state.tools.append_questions.execute!(first, options);
    const next = batch([15], "二");
    next.sections[0].questions[0].score = null;
    await state.tools.append_questions.execute!(next, options);
    expect(update).toHaveBeenLastCalledWith({ total: null, completed: 3 });
    await state.tools.report_exam_meta.execute!(
      { total: null, paperSize: "A4", columns: 3, orientation: "portrait" },
      options,
    );
    await state.tools.submit_exam.execute!({ name: "练习册节选", totalScore: null }, options);
    expect(state.isComplete()).toBe(true);
    expect(state.result()).toMatchObject({
      name: "练习册节选",
      totalScore: null,
      layout: { paperSize: "A4", columns: 3, orientation: "portrait" },
    });
    expect(
      state
        .result()
        ?.sections.map((section) => section.questions.map((question) => question.number)),
    ).toEqual([[15, 18], [15]]);
    expect(
      state
        .result()
        ?.sections.every((section) =>
          section.questions.every((question) => question.score === null),
        ),
    ).toBe(true);
  });
  it("keeps the previous metadata when saving corrected layout fails", async () => {
    const progress = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    const state = createResultTools(progress);
    await state.tools.report_exam_meta.execute!(
      { total: null, paperSize: "A4", columns: 1 },
      options,
    );
    await state.tools.append_questions.execute!(batch([1]), options);
    await expect(
      state.tools.report_exam_meta.execute!({ total: null, paperSize: "A3", columns: 4 }, options),
    ).rejects.toThrow("disk full");
    expect(state.result()?.layout).toEqual({
      paperSize: "A4",
      columns: 1,
      orientation: "portrait",
    });
  });
  it("keeps early batches across sections and finishes without resending any question", async () => {
    const progress = vi.fn().mockResolvedValue(undefined);
    const state = createResultTools(progress);
    await state.tools.report_exam_meta.execute!({ total: 5, paperSize: "A4", columns: 1 }, options);
    await state.tools.append_questions.execute!(batch([1, 2, 3]), options);
    expect(state.isComplete()).toBe(false);
    expect(progress.mock.calls[0][0]).toEqual(batch([1, 2, 3]));
    await state.tools.append_questions.execute!(batch([4]), options);
    await state.tools.append_questions.execute!(batch([9], "二"), options);
    const secondSection = batch([9], "二").sections[0];
    secondSection.questions[0].description = "公共题干";
    secondSection.questions[0].subquestions = [
      { number: "(1)", description: "证明。", materials: [], score: null },
    ];
    await state.tools.append_questions.execute!(
      { ...batch([9], "二"), sections: [secondSection] },
      options,
    );
    expect(
      state
        .result()
        ?.sections.map((section) => section.questions.map((question) => question.number)),
    ).toEqual([[1, 2, 3, 4], [9]]);
    expect(state.isComplete()).toBe(false);
    const final = await state.tools.submit_exam.execute!(
      { name: "数学期末试卷", totalScore: 100 },
      options,
    );
    expect(final).toMatchObject({ sections: 2, questions: 5 });
    expect(state.isComplete()).toBe(true);
    expect(state.result()).toMatchObject({ name: "数学期末试卷", totalScore: 100 });
    expect(state.result()?.sections[1].questions[0]).toEqual(secondSection.questions[0]);
    expect(progress).toHaveBeenCalledTimes(5);
  });
  it("serializes simultaneous additions and finalization without dropping earlier batches", async () => {
    const progress = vi.fn(async () => {
      await Promise.resolve();
    });
    const state = createResultTools(progress);
    await state.tools.report_exam_meta.execute!({ total: 5, paperSize: "A4", columns: 1 }, options);
    await Promise.all([
      state.tools.append_questions.execute!(batch([1, 2, 3]), options),
      state.tools.append_questions.execute!(batch([4, 5]), options),
      state.tools.submit_exam.execute!({ name: "数学", totalScore: null }, options),
    ]);
    expect(state.result()?.sections[0].questions.map((question) => question.number)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(state.isComplete()).toBe(true);
    await expect(state.tools.append_questions.execute!(batch([6]), options)).rejects.toMatchObject({
      code: "EXAM_ALREADY_SUBMITTED",
    });
  });
  it("makes retried batches idempotent and replaces corrected questions at their original position", async () => {
    const state = createResultTools();
    await state.tools.report_exam_meta.execute!({ total: 3, paperSize: "A4", columns: 1 }, options);
    await state.tools.append_questions.execute!(batch([1, 2, 3]), options);
    await state.tools.append_questions.execute!(batch([1, 2, 3]), options);
    const correction = batch([2]);
    correction.sections[0].questions[0].description = "修正后的题干";
    await state.tools.append_questions.execute!(correction, options);
    const questions = state.result()!.sections[0].questions;
    expect(questions.map((question) => question.number)).toEqual([1, 2, 3]);
    expect(questions[1].description).toBe("修正后的题干");
  });
  it("keeps the last saved state when persistence fails and allows a later retry", async () => {
    const progress = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const state = createResultTools(progress);
    await state.tools.report_exam_meta.execute!({ total: 2, paperSize: "A4", columns: 1 }, options);
    await state.tools.append_questions.execute!(batch([1]), options);
    await expect(state.tools.append_questions.execute!(batch([2]), options)).rejects.toThrow(
      "disk full",
    );
    expect(state.result()).toEqual(batch([1]));
    expect(state.isComplete()).toBe(false);
    await state.tools.append_questions.execute!(batch([2]), options);
    expect(state.result()).toEqual(batch([1, 2]));
  });
  it("cannot finish before any questions have been saved", async () => {
    const state = createResultTools();
    await state.tools.report_exam_meta.execute!({ total: 1, paperSize: "A4", columns: 1 }, options);
    await expect(
      state.tools.submit_exam.execute!({ name: "数学", totalScore: null }, options),
    ).rejects.toMatchObject({ code: "EXAM_EMPTY" });
    expect(state.isComplete()).toBe(false);
    expect(state.result()).toBeUndefined();
  });
  it("retains shared instructions and known scores when later batches omit them", async () => {
    const state = createResultTools();
    await state.tools.report_exam_meta.execute!({ total: 2, paperSize: "A4", columns: 1 }, options);
    const first = batch([1]);
    first.totalScore = 100;
    first.sections[0].score = 40;
    await state.tools.append_questions.execute!(first, options);
    const next = batch([2]);
    next.sections[0].description = "";
    await state.tools.append_questions.execute!(next, options);
    expect(state.result()).toMatchObject({
      totalScore: 100,
      sections: [
        { description: "每小题 5 分。", score: 40, questions: [{ number: 1 }, { number: 2 }] },
      ],
    });
  });
  it("requires an initial total, rejects incomplete submission and corrects counts without duplicating saved questions", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const state = createResultTools(undefined, update);
    await expect(state.tools.append_questions.execute!(batch([1]), options)).rejects.toMatchObject({
      code: "EXAM_META_REQUIRED",
    });
    expect(state.result()).toBeUndefined();
    await state.tools.report_exam_meta.execute!({ total: 2, paperSize: "A4", columns: 1 }, options);
    expect(update).toHaveBeenLastCalledWith({ total: 2, completed: 0 });
    await state.tools.append_questions.execute!(batch([1]), options);
    await state.tools.append_questions.execute!(batch([1]), options);
    expect(update).toHaveBeenLastCalledWith({ total: 2, completed: 1 });
    await expect(
      state.tools.submit_exam.execute!({ name: "test", totalScore: null }, options),
    ).rejects.toMatchObject({ code: "EXAM_MISSING_QUESTIONS" });
    await expect(
      state.tools.append_questions.execute!(batch([2, 3]), options),
    ).rejects.toMatchObject({ code: "EXAM_COUNT_INVALID" });
    await state.tools.report_exam_meta.execute!({ total: 3, paperSize: "A4", columns: 1 }, options);
    await state.tools.append_questions.execute!(batch([2, 3]), options);
    await expect(
      state.tools.report_exam_meta.execute!({ total: 2, paperSize: "A4", columns: 1 }, options),
    ).rejects.toMatchObject({ code: "EXAM_COUNT_INVALID" });
    await state.tools.submit_exam.execute!({ name: "test", totalScore: null }, options);
    expect(update).toHaveBeenLastCalledWith({ total: 3, completed: 3 });
  });
  it("does not commit a reported total if persistence fails", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("db failed"))
      .mockResolvedValue(undefined);
    const state = createResultTools(undefined, update);
    await expect(
      state.tools.report_exam_meta.execute!({ total: 1, paperSize: "A4", columns: 1 }, options),
    ).rejects.toThrow("db failed");
    await expect(state.tools.append_questions.execute!(batch([1]), options)).rejects.toMatchObject({
      code: "EXAM_META_REQUIRED",
    });
    await state.tools.report_exam_meta.execute!({ total: 1, paperSize: "A4", columns: 1 }, options);
    await state.tools.append_questions.execute!(batch([1]), options);
    expect(update).toHaveBeenLastCalledWith({ total: 1, completed: 1 });
  });
});
