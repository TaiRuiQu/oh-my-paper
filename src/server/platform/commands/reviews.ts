import "server-only";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command, CommandContext } from "./types";
import { assertCanReview, json, missing } from "../access";
import { reviewRule, exceedsReviewDifference } from "@/lib/document-layout";
import { finalGrades } from "../analytics";
import type { Assessment, BankQuestion, Paper, Review, ScanSubmission } from "../types";
import { AccessError, RequestError } from "@/server/http/errors";
export async function executeReviewsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
  context: CommandContext,
) {
  switch (command.type) {
    case "review.save": {
      const r = command.review;
      if (context.source === "AI" && r.round !== "FIRST")
        throw new RequestError(400, "AI只允许第一评，第二评与仲裁必须人工完成。");
      const s = await db.scanSubmission.findUnique({ where: { id: r.submissionId } });
      if (!s) throw missing();
      const exam = await db.assessment.findUnique({
        where: { id: s.assessmentId },
        include: { papers: true },
      });
      if (!exam || !exam.studentIds.includes(s.studentId)) throw missing();
      const student = await db.classroomStudent.findUniqueOrThrow({
        where: { id: s.studentId },
      });
      const config = exam.papers.find((p) => p.paperId === s.paperId);
      if (!config) throw missing();
      await assertCanReview(db, a, exam, student.classroomId, config.subject);
      if (exam.published) throw new RequestError(409, "已发布成绩的考试不能重新评阅。");
      const paper = await db.paper.findUniqueOrThrow({
        where: { id: s.paperId },
        include: { items: true },
      });
      const item = paper.items.find((i) => i.id === r.itemId);
      if (!item || r.score > item.score) throw new RequestError(400, "评分必须在题目分值范围内。");
      const snapshot = item.snapshot as unknown as BankQuestion;
      const partScores = r.partScores ?? [];
      if (snapshot.type === "MIXED") {
        const parts = snapshot.content.parts,
          weights = parts.reduce((n, part) => n + part.score, 0);
        if (
          !weights ||
          partScores.length !== parts.length ||
          new Set(partScores.map((p) => p.partId)).size !== parts.length ||
          parts.some((part) => !partScores.some((p) => p.partId === part.id))
        )
          throw new RequestError(400, "混合题必须完整记录每个小问的得分。");
        if (
          partScores.some(
            (p) =>
              p.score >
              (item.score * parts.find((part) => part.id === p.partId)!.score) / weights + 0.000001,
          ) ||
          Math.abs(partScores.reduce((n, p) => n + p.score, 0) - r.score) > 0.000001
        )
          throw new RequestError(400, "小问分数必须符合权重上限，且合计等于题目得分。");
      } else if (partScores.length) throw new RequestError(400, "只有混合题可以填写小问分数。");
      const rows = await db.review.findMany({
        where: { submissionId: s.id, itemId: r.itemId },
      });
      const previous = rows.find((row) => row.round === r.round),
        first = rows.find((row) => row.round === "FIRST"),
        second = rows.find((row) => row.round === "SECOND");
      if (previous && previous.reviewerId !== a.id)
        throw new AccessError(403, "不能覆盖其他评阅者的评分。");
      const policy = reviewRule(config as unknown as Assessment["papers"][number], r.itemId);
      if (r.round !== "FIRST" && !policy.doubleReview)
        throw new RequestError(400, "本题无需第二评或仲裁。");
      if (
        (r.round === "SECOND" && first?.reviewerId === a.id) ||
        (r.round === "FIRST" && second?.reviewerId === a.id)
      )
        throw new RequestError(409, "同一道双评题必须由两位不同教师独立评分。");
      if (
        r.round === "ARBITRATION" &&
        (!policy.arbitrationEnabled ||
          !first ||
          first.source === "AI" ||
          !second ||
          [first.reviewerId, second.reviewerId].includes(a.id) ||
          !exceedsReviewDifference(first.score, second.score, policy.maxDifference))
      )
        throw new RequestError(409, "仲裁须已启用、分差大于最大分差，并由第三位教师完成。");
      if (r.round !== "ARBITRATION" && rows.some((row) => row.round === "ARBITRATION"))
        throw new RequestError(409, "仲裁已完成，不能改动前两评。");
      await db.reviewEvent.create({
        data: {
          ...r,
          partScores: json(partScores),
          reviewerId: a.id,
          source: context.source ?? "HUMAN",
          aiJobId: context.source === "AI" ? context.jobId : null,
        },
      });
      const review = await db.review.upsert({
        where: {
          submissionId_itemId_round: { submissionId: s.id, itemId: r.itemId, round: r.round },
        },
        create: {
          ...r,
          partScores: json(partScores),
          reviewerId: a.id,
          source: context.source ?? "HUMAN",
          aiJobId: context.source === "AI" ? context.jobId : null,
        },
        update: {
          score: r.score,
          feedback: r.feedback,
          partScores: json(partScores),
          source: context.source ?? "HUMAN",
          aiJobId: context.source === "AI" ? context.jobId : null,
        },
      });
      const all = await db.review.findMany({ where: { submissionId: s.id } });
      const grades = finalGrades(
        {
          ...paper,
          createdAt: paper.createdAt.toISOString(),
          updatedAt: paper.updatedAt.toISOString(),
        } as unknown as Paper,
        { ...config, conversion: config.conversion } as unknown as Assessment["papers"][number],
        { ...s, createdAt: s.createdAt.toISOString() } as unknown as ScanSubmission,
        all.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) as Review[],
      );
      await db.scanSubmission.update({
        where: { id: s.id },
        data: { status: grades.every((g) => g.status === "FINAL") ? "GRADED" : "REVIEW" },
      });
      return { id: review.id };
    }
  }
}
