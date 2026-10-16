import { describe, expect, it } from "vitest";
import type { BankQuestion, WrongQuestion } from "@/contracts/platform";
import { consolidationPaperSchema, replayPaperSchema } from "@/contracts/revision-papers";
import { revisionContent, uniqueReplayQuestions, wrongKnowledgeTags } from "@/lib/revision-papers";
import { aiJobResultLink } from "@/lib/ai-job-display";
import type { AiJobDTO } from "@/contracts/platform-ai";

const question = {
  id: "q",
  type: "MIXED",
  knowledgeTags: ["综合"],
  content: {
    stem: "原题",
    parts: [
      { id: "a", knowledgeTags: ["代数"] },
      { id: "b", knowledgeTags: ["几何"] },
    ],
  },
} as BankQuestion;
const wrong = {
  assessmentId: "exam",
  itemId: "item",
  question,
  maximum: 10,
  wrongPartIds: ["a"],
} as WrongQuestion;
const input = {
  studentId: "student",
  name: "复习",
  subject: "数学",
  sources: [{ assessmentId: "exam", itemId: "item" }],
};
describe("revision paper selection", () => {
  it("rewrites copied asset references inside Markdown and mixed subquestions without changing the source", () => {
    const content = {
      ...question.content,
      stem: "![图](/api/platform/assets/old)",
      images: ["/api/platform/assets/old"],
      parts: [{ stem: "见 /api/platform/assets/old", answers: ["2"] }],
    } as BankQuestion["content"];
    const copy = revisionContent(
      content,
      new Map([["/api/platform/assets/old", "/api/platform/assets/new"]]),
    );
    expect(copy.stem).toContain("/api/platform/assets/new");
    expect(copy.images).toEqual(["/api/platform/assets/new"]);
    expect(copy.parts[0].stem).toContain("/api/platform/assets/new");
    expect(content.images).toEqual(["/api/platform/assets/old"]);
  });
  it("targets only lost mixed-question parts", () =>
    expect(wrongKnowledgeTags(wrong)).toEqual(["代数"]));
  it("keeps historical versions and original scores while merging identical repeats", () => {
    const version = {
      ...wrong,
      question: { ...question, content: { ...question.content, stem: "修改后的题干" } },
    };
    const differentScore = { ...wrong, maximum: 20 };
    expect(
      uniqueReplayQuestions([
        wrong,
        { ...wrong, assessmentId: "another" },
        version,
        differentScore,
      ]),
    ).toEqual([wrong, version, differentScore]);
  });
  it("rejects empty, duplicate and oversized source selections", () => {
    expect(replayPaperSchema.safeParse({ ...input, sources: [] }).success).toBe(false);
    expect(
      replayPaperSchema.safeParse({ ...input, sources: [...input.sources, ...input.sources] })
        .success,
    ).toBe(false);
    expect(
      replayPaperSchema.safeParse({
        ...input,
        sources: Array.from({ length: 501 }, (_, i) => ({
          assessmentId: "exam",
          itemId: String(i),
        })),
      }).success,
    ).toBe(false);
  });
  it("keeps source validation in consolidation inputs and rejects client-supplied questions", () => {
    expect(consolidationPaperSchema.parse(input)).toMatchObject({ count: 5, score: 5 });
    expect(
      consolidationPaperSchema.safeParse({
        ...input,
        sources: [...input.sources, ...input.sources],
      }).success,
    ).toBe(false);
    expect(consolidationPaperSchema.safeParse({ ...input, question }).success).toBe(false);
    expect(consolidationPaperSchema.safeParse({ ...input, count: 21 }).success).toBe(false);
  });
  it("links completed consolidation jobs to a preview accessible to students", () => {
    const job = {
      kind: "CONSOLIDATE",
      status: "COMPLETED",
      result: { result: { paperId: "paper", paperKind: "HOMEWORK" } },
    } as AiJobDTO;
    expect(aiJobResultLink(job)?.href).toBe("/workspace/revision-papers/paper");
    expect(aiJobResultLink({ ...job, result: { result: { skipped: [] } } })).toBeUndefined();
  });
});
