import { z } from "zod";

export const revisionSourceSchema = z.strictObject({
  assessmentId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
});
export const replayPaperSchema = z
  .strictObject({
    studentId: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    subject: z.string().trim().min(1).max(40),
    sources: z.array(revisionSourceSchema).min(1).max(500),
  })
  .superRefine((input, ctx) => {
    const keys = input.sources.map((source) =>
      JSON.stringify([source.assessmentId, source.itemId]),
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", path: ["sources"], message: "不能重复选择同一条错题记录。" });
  });
export const consolidationPaperSchema = replayPaperSchema.safeExtend({
  count: z.number().int().min(1).max(20).default(5),
  score: z.number().positive().max(100).default(5),
});
export type RevisionSource = z.infer<typeof revisionSourceSchema>;
export type ReplayPaperInput = z.infer<typeof replayPaperSchema>;
export type ConsolidationPaperInput = z.infer<typeof consolidationPaperSchema>;
