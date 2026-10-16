import "server-only";
import { paperRecord, assessmentRecord } from "../records";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command, CommandContext } from "./types";
import { assertCanUseAssessmentParticipant, json, missing } from "../access";
import { reviewRule, exceedsReviewDifference } from "@/lib/document-layout";
import { finalGrades } from "../analytics";
import type { Assessment, BankQuestion, Paper, Review, ScanSubmission } from "../types";
import { AccessError, RequestError } from "@/server/http/errors";
import { rosterInclude } from "../assessment-roster";
export async function executeReviewsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
  context: CommandContext,
) {
  switch (command.type) {
    case "review.save": {
      const { expectedVersion, ...r } = command.review;
      if (context.source === "AI" && r.round !== "FIRST")
        throw new RequestError(400, "AI只允许第一评，第二评与仲裁必须人工完成。");
      const s = await db.scanSubmission.findUnique({ where: { id: r.submissionId } });
      if (!s) throw missing();
      if (!s.active)
        throw new RequestError(
          409,
          "这份作答已退回或被新提交替代；本次评分尚未保存，请核对当前轮次。",
        );
      const examRow = await db.assessment.findUnique({
        where: { id: s.assessmentId },
        include: rosterInclude,
      });
      if (!examRow) throw missing();
      const exam = assessmentRecord(examRow);
      const config = exam.papers.find((p) => p.paperId === s.paperId);
      if (!config) throw missing();
      const participant = await assertCanUseAssessmentParticipant(
        db,
        a,
        exam,
        s.studentId,
        s.paperId,
        { review: true },
      );
      if (exam.published) throw new RequestError(409, "已发布成绩的考试不能重新评阅。");
      if (context.source === "AI") {
        const job = context.jobId
          ? await db.aiJob.findUnique({ where: { id: context.jobId } })
          : null;
        const input = job?.input as
          | {
              assessmentId?: string;
              paperId?: string;
              classroomId?: string;
              rosterRevision?: number;
            }
          | undefined;
        if (
          !job ||
          job.kind !== "GRADE" ||
          job.userId !== a.id ||
          job.status !== "RUNNING" ||
          input?.assessmentId !== exam.id ||
          input.paperId !== s.paperId ||
          input.classroomId !== participant.classroomId
        )
          throw new RequestError(409, "AI 批改任务与本次参试范围不一致。");
        if (input.rosterRevision !== exam.rosterRevision)
          throw new RequestError(409, "参试名单在 AI 批改期间已更新，请重新提交任务。");
      }
      const paper = paperRecord(
        await db.paper.findUniqueOrThrow({
          where: { id: s.paperId },
        }),
      );
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
      if ((previous?.version ?? 0) !== expectedVersion)
        throw new RequestError(409, "评分版本已更新，请重新读取并核对最新评分；本次修改尚未保存。");
      // GRADE only starts from an unreviewed baseline. Never let a running or older
      // job adopt the latest human version and present itself as an update.
      if (context.source === "AI" && (expectedVersion !== 0 || rows.length))
        throw new RequestError(409, "AI 批改的未评分基线已失效，请重新提交任务。");
      const version = expectedVersion + 1;
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
      const data = {
        score: r.score,
        feedback: r.feedback,
        partScores: json(partScores),
        source: context.source ?? "HUMAN",
        aiJobId: context.source === "AI" ? context.jobId : null,
        version,
      };
      let reviewId: string;
      if (previous) {
        const updated = await db.review.updateMany({
          where: { id: previous.id, version: expectedVersion },
          data,
        });
        if (updated.count !== 1)
          throw new RequestError(
            409,
            "评分版本已更新，请重新读取并核对最新评分；本次修改尚未保存。",
          );
        reviewId = previous.id;
      } else {
        const created = await db.review.create({ data: { ...r, ...data, reviewerId: a.id } });
        reviewId = created.id;
      }
      await db.reviewEvent.create({
        data: { ...r, ...data, reviewerId: a.id },
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
      return { id: reviewId, reviewVersion: version };
    }
  }
}
