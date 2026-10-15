import { z } from "zod";
import { studentNumberSchema } from "@/contracts/auth";
import { RECORD_NAME_MAX_LENGTH } from "@/contracts/platform";
const id = z.string().trim().min(1).max(128);
const text = z.string().trim().max(100000);
const recordName = z
  .string()
  .trim()
  .min(1, "请输入名称。")
  .max(RECORD_NAME_MAX_LENGTH, `名称不能超过 ${RECORD_NAME_MAX_LENGTH} 字。`);
const documentFontFamily = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N} ._()-]+$/u, "请输入单个本机字体名称。");
const subject = z.string().trim().min(1).max(40);
const tags = z
  .array(z.string().trim().min(1).max(120))
  .max(100)
  .transform((v) => [...new Set(v)]);
const score = z.number().finite().min(0).max(10000);
const type = z.enum(["SINGLE", "MULTIPLE", "BLANK", "SUBJECTIVE", "MIXED"]);
const options = z.array(z.strictObject({ label: z.string().trim().min(1).max(10), text })).max(26);
const answers = z.array(text).max(100);
const part = z.strictObject({
  id,
  type: type.exclude(["MIXED"]),
  stem: text.min(1),
  options,
  answers,
  explanation: text,
  rubric: text,
  knowledgeTags: tags,
  score,
});
export const questionContentSchema = z.strictObject({
  stem: text.min(1),
  options,
  answers,
  explanation: text,
  rubric: text,
  parts: z.array(part).max(100),
  images: z.array(z.string().max(2048)).max(20),
});
export const questionInputSchema = z
  .object({
    id: id.optional(),
    type,
    subject,
    grade: z.string().trim().max(40),
    difficulty: z.number().min(0).max(1),
    knowledgeTags: tags,
    content: questionContentSchema,
  })
  .superRefine((q, c) => {
    function check(t: string, opts: { label: string }[], ans: string[], path: (string | number)[]) {
      if (new Set(opts.map((o) => o.label)).size !== opts.length)
        c.addIssue({ code: "custom", path, message: "选项标签不能重复。" });
      if (["SINGLE", "MULTIPLE"].includes(t)) {
        if (opts.length < 2)
          c.addIssue({ code: "custom", path, message: "选择题至少需要两个选项。" });
        if (
          ans.some((a) => !opts.some((o) => o.label === a)) ||
          (t === "SINGLE" && ans.length > 1) ||
          new Set(ans).size !== ans.length
        )
          c.addIssue({ code: "custom", path, message: "选择题答案必须是有效且不重复的选项。" });
      }
    }
    check(q.type, q.content.options, q.content.answers, ["content"]);
    q.content.parts.forEach((p, i) => check(p.type, p.options, p.answers, ["content", "parts", i]));
    if (q.type === "MIXED" && !q.content.parts.length)
      c.addIssue({
        code: "custom",
        path: ["content", "parts"],
        message: "混合题需要至少一个子题。",
      });
    if (q.type !== "MIXED" && q.content.parts.length)
      c.addIssue({
        code: "custom",
        path: ["content", "parts"],
        message: "带独立子题的题目请选混合题。",
      });
    if (new Set(q.content.parts.map((p) => p.id)).size !== q.content.parts.length)
      c.addIssue({ code: "custom", path: ["content", "parts"], message: "子题编号不能重复。" });
  });
export const paperInputSchema = z
  .object({
    id: id.optional(),
    name: recordName,
    kind: z.enum(["EXAM", "HOMEWORK"]),
    subject,
    grade: text.max(40),
    instructions: text,
    layout: z.strictObject({
      paperSize: z.enum(["A4", "A3"]),
      columns: z.number().int().min(1).max(4),
      orientation: z.enum(["portrait", "landscape"]).optional(),
      fontFamily: documentFontFamily.optional(),
      textBlocks: z
        .array(
          z.strictObject({
            id,
            text,
            beforeQuestionId: id.optional(),
            pageBreakBefore: z.boolean().optional(),
          }),
        )
        .max(500)
        .optional(),
      marginMm: z.number().min(8).max(40).optional(),
      fontSizePt: z.number().min(9).max(24).optional(),
      lineHeight: z.number().min(1).max(3).optional(),
      showScores: z.boolean().optional(),
      questionLayouts: z
        .record(
          id,
          z.strictObject({
            pageBreakBefore: z.boolean().optional(),
            answerSpaceMm: z.number().min(0).max(200).optional(),
            spaceAfterMm: z.number().min(0).max(60).optional(),
          }),
        )
        .optional(),
    }),
    items: z
      .array(
        z.strictObject({
          questionId: id,
          score,
          section: text.max(100),
          content: questionContentSchema.optional(),
          question: questionInputSchema.optional(),
        }),
      )
      .max(500),
  })
  .superRefine((p, c) => {
    if (new Set(p.items.map((i) => i.questionId)).size !== p.items.length)
      c.addIssue({ code: "custom", path: ["items"], message: "同一卷子不能重复选同一道题。" });
  });
export const boxSchema = z
  .strictObject({
    page: z.number().int().min(1).max(100),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001, "区域必须位于页面内。");
export const regionSchema = z
  .strictObject({
    page: z.number().int().min(1).max(100),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    itemId: id,
    kind: z.enum(["CHOICE", "BLANK", "WRITING"]),
    options: z.array(z.string().max(10)).max(26).optional(),
    multiple: z.boolean().optional(),
    image: z.string().max(2048).optional(),
    label: text.max(100).optional(),
    writingStyle: z.enum(["plain", "lines", "grid"]).optional(),
  })
  .refine((b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001, "区域必须位于页面内。");
export const cardLayoutSchema = z
  .strictObject({
    showAbsent: z.boolean().optional(),
    showFooter: z.boolean().optional(),
    showSubject: z.boolean().optional(),
    locked: z.boolean().optional(),
    annotations: z
      .array(boxSchema.safeExtend({ id, text: text.max(2000) }))
      .max(100)
      .optional(),
    omrVersion: z.literal(2).optional(),
    paperSize: z.enum(["A4", "A3"]).optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    columns: z.number().int().min(1).max(4).optional(),
    fontFamily: documentFontFamily.optional(),
    width: z.number().positive().max(10000),
    height: z.number().positive().max(10000),
    pageCount: z.number().int().min(1).max(100),
    markers: z
      .array(z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
      .length(4),
    studentNumber: z.strictObject({
      digits: z.number().int().min(1).max(20),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      cellWidth: z.number().positive().max(1),
      cellHeight: z.number().positive().max(1),
    }),
    regions: z.array(regionSchema).min(1).max(1000),
  })
  .superRefine((v, c) => {
    if (v.regions.some((r) => r.page > v.pageCount))
      c.addIssue({ code: "custom", path: ["regions"], message: "区域引用不存在的页面。" });
  });
export const templateInputSchema = z.object({
  id: id.optional(),
  paperId: id,
  name: text.min(1).max(200),
  subject,
  layout: cardLayoutSchema,
});
export const conversionSchema = z
  .strictObject({
    enabled: z.boolean(),
    bands: z
      .array(
        z.strictObject({ upperPercent: z.number().positive().max(100), min: score, max: score }),
      )
      .max(20),
  })
  .superRefine((v, c) => {
    if (!v.enabled) return;
    if (
      !v.bands.length ||
      v.bands.at(-1)?.upperPercent !== 100 ||
      v.bands.some(
        (b, i) =>
          b.min > b.max ||
          (i > 0 && (b.upperPercent <= v.bands[i - 1].upperPercent || b.max > v.bands[i - 1].min)),
      )
    )
      c.addIssue({
        code: "custom",
        path: ["bands"],
        message: "赋分区间应从高到低递减，百分比递增并以100结束。",
      });
  });
export const assessmentInputSchema = z
  .object({
    id: id.optional(),
    name: recordName,
    kind: z.enum(["EXAM", "HOMEWORK"]),
    reviewScope: z.enum(["CLASSROOM", "GRADE"]).default("CLASSROOM"),
    classroomIds: z.array(id).min(1).max(100),
    papers: z
      .array(
        z.strictObject({
          paperId: id,
          subject,
          gradingMode: z.enum(["SINGLE", "DOUBLE"]),
          arbitrationThreshold: score,
          questionRules: z
            .record(
              id,
              z.strictObject({
                doubleReview: z.boolean(),
                arbitrationEnabled: z.boolean(),
                maxDifference: score,
              }),
            )
            .optional(),
          conversion: conversionSchema,
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((a, c) => {
    if (a.kind === "HOMEWORK" && a.reviewScope !== "CLASSROOM")
      c.addIssue({ code: "custom", message: "作业使用班级阅卷范围。" });
    if (
      new Set(a.classroomIds).size !== a.classroomIds.length ||
      new Set(a.papers.map((p) => p.paperId)).size !== a.papers.length ||
      new Set(a.papers.map((p) => p.subject)).size !== a.papers.length
    )
      c.addIssue({ code: "custom", message: "班级、试卷和科目不能重复。" });
  });
export const submissionInputSchema = z
  .object({
    id: id.optional(),
    assessmentId: id,
    paperId: id,
    studentId: id,
    templateId: id.nullable().optional(),
    kind: z.enum(["CARD", "WORKBOOK"]),
    sourceFiles: z.array(z.string().min(1).max(2048)).max(100),
    answers: z
      .array(
        z.strictObject({
          itemId: id,
          text,
          images: z.array(z.string().max(2048)).max(30),
          box: boxSchema.optional(),
          sourcePage: z.string().max(2048).optional(),
        }),
      )
      .max(500),
    alignment: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .superRefine((s, c) => {
    if (new Set(s.answers.map((a) => a.itemId)).size !== s.answers.length)
      c.addIssue({ code: "custom", path: ["answers"], message: "每道题只能保存一份作答。" });
  });
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("question.save"), question: questionInputSchema }),
  z.strictObject({ type: z.literal("question.delete"), id }),
  z.strictObject({ type: z.literal("paper.save"), paper: paperInputSchema }),
  z.strictObject({ type: z.literal("paper.delete"), id }),
  z.strictObject({ type: z.literal("paper.rename"), id, name: recordName }),
  z.strictObject({
    type: z.literal("classroom.save"),
    classroom: z.strictObject({
      id: id.optional(),
      name: text.min(1).max(200),
      grade: text.max(40),
    }),
  }),
  z.strictObject({
    type: z.literal("student.save"),
    student: z.strictObject({
      id: id.optional(),
      classroomId: id,
      studentNumber: studentNumberSchema.optional(),
      name: text.min(1).max(80),
      userId: id.nullable().optional(),
    }),
  }),
  z.strictObject({ type: z.literal("student.delete"), id }),
  z.strictObject({ type: z.literal("assessment.save"), assessment: assessmentInputSchema }),
  z.strictObject({ type: z.literal("assessment.publish"), id, published: z.boolean() }),
  z.strictObject({ type: z.literal("assessment.rename"), id, name: recordName }),
  z.strictObject({
    type: z.literal("template.save"),
    template: templateInputSchema,
    paperDraft: z
      .strictObject({
        itemIds: z.array(id).min(1).max(500),
        items: paperInputSchema.shape.items,
      })
      .optional(),
  }),
  z.strictObject({ type: z.literal("template.delete"), id }),
  z.strictObject({ type: z.literal("submission.save"), submission: submissionInputSchema }),
  z.strictObject({
    type: z.literal("review.save"),
    review: z.strictObject({
      submissionId: id,
      itemId: id,
      round: z.enum(["FIRST", "SECOND", "ARBITRATION"]),
      partScores: z
        .array(z.strictObject({ partId: id, score, feedback: text }))
        .max(100)
        .optional(),
      score,
      feedback: text,
    }),
  }),
]);
