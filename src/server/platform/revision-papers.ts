import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import type { BankQuestion, PlatformState } from "@/contracts/platform";
import {
  replayPaperSchema,
  type ReplayPaperInput,
  type ConsolidationPaperInput,
} from "@/contracts/revision-papers";
import {
  questionKnowledgeTags,
  revisionSourceKey,
  uniqueReplayQuestions,
  wrongKnowledgeTags,
  revisionContent,
} from "@/lib/revision-papers";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { AccessError, RequestError } from "@/server/http/errors";
import { loadState } from "./queries";
import { executePapersCommand } from "./commands/papers";
import { assetId } from "./assets";
import type { Db } from "./access";
import { paperRecord } from "./records";

export async function revisionContext(userId: string, input: ReplayPaperInput, db: Db = getDb()) {
  const state = await loadState({ id: userId }, db);
  const student = state.classrooms.flatMap((c) => c.students).find((s) => s.id === input.studentId);
  const report = state.analytics.students.find((r) => r.studentId === input.studentId);
  if (!student || !report || (state.actor.role === "STUDENT" && student.userId !== userId))
    throw new AccessError(404, "学生学习报告不存在或无权访问。");
  const wrong = input.sources.map((source) => {
    const entry = report.wrongQuestions.find(
      (w) => revisionSourceKey(w) === revisionSourceKey(source),
    );
    if (!entry || entry.question.subject !== input.subject)
      throw new AccessError(404, "所选错题不存在、学科不符或已无权访问，请刷新后重选。");
    return entry;
  });
  return { state, wrong, grade: wrong[0].question.grade, student };
}

export async function consolidationContext(
  userId: string,
  input: ConsolidationPaperInput,
  db: Db = getDb(),
) {
  const context = await revisionContext(userId, input, db);
  const { state, wrong, grade } = context;
  const bank =
    state.actor.role === "STUDENT"
      ? ((
          await db.question.findMany({
            where: { ownerId: { in: [...new Set(wrong.map((w) => w.question.ownerId))] } },
          })
        ).map((q) => ({
          ...q,
          createdAt: q.createdAt.toISOString(),
          updatedAt: q.updatedAt.toISOString(),
        })) as unknown as BankQuestion[])
      : state.questions;
  // Exclude unpublished attempts too, using their question identities only inside the server.
  const attempts = await db.scanSubmission.findMany({
    where: { studentId: input.studentId },
    select: { paperId: true },
  });
  const attempted = (
    await db.paper.findMany({ where: { id: { in: attempts.map((s) => s.paperId) } } })
  ).flatMap((p) => paperRecord(p).items.map((i) => i.snapshot));
  const attemptedIds = new Set(attempted.map((q) => q.id));
  const attemptedStems = new Set(
    [...attempted, ...wrong.map((w) => w.question)].map((q) => q.content.stem.trim()),
  );
  const tags = new Set(wrong.flatMap(wrongKnowledgeTags));
  const candidates = bank.filter(
    (q) =>
      q.subject === input.subject &&
      q.grade === grade &&
      !attemptedIds.has(q.id) &&
      !attemptedStems.has(q.content.stem.trim()) &&
      questionKnowledgeTags(q).some((tag) => tags.has(tag)),
  );
  return { ...context, candidates, tags: [...tags] };
}

/** Only server-resolved authorized questions reach this function; generic student writes stay forbidden. */
export async function saveRevisionPaper(
  db: Prisma.TransactionClient,
  actor: PlatformState["actor"],
  input: ReplayPaperInput,
  questions: { question: BankQuestion; score: number }[],
  instructions: string,
  writtenPaths: string[],
) {
  const directory = join(getStoragePaths().storage, "platform-assets");
  const imageCopies = new Map<string, string>();
  for (const { question } of questions) {
    for (const url of question.content.images) {
      if (imageCopies.has(url)) continue;
      const id = assetId(url);
      const asset = id ? await db.platformAsset.findUnique({ where: { id } }) : null;
      if (!asset) throw new AccessError(404, "题目配图已不可用，请刷新后重试。");
      if (asset.ownerId === actor.id) {
        imageCopies.set(url, url);
        continue;
      }
      if (!resolve(asset.path).startsWith(resolve(directory) + sep))
        throw new AccessError(404, "题目配图不可用。");
      const copyId = randomUUID();
      const path = join(directory, `${copyId}.png`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      writtenPaths.push(path);
      await copyFile(asset.path, path);
      await db.platformAsset.create({
        data: {
          id: copyId,
          ownerId: actor.id,
          name: asset.name,
          path,
          contentType: asset.contentType,
        },
      });
      imageCopies.set(url, `/api/platform/assets/${copyId}`);
    }
  }
  const sourceIds = new Set<string>();
  const result = await executePapersCommand(db, actor, {
    type: "paper.save",
    paper: {
      name: input.name,
      kind: "HOMEWORK",
      subject: input.subject,
      grade: questions[0].question.grade,
      instructions,
      layout: { ...DOCUMENT_DEFAULTS },
      items: questions.map(({ question, score }) => {
        // Keep the bank identity for future attempt exclusion, with distinct keys for historical versions.
        const questionId = sourceIds.has(question.id) ? randomUUID() : question.id;
        sourceIds.add(questionId);
        return {
          questionId,
          score,
          section: {
            SINGLE: "单选题",
            MULTIPLE: "多选题",
            BLANK: "填空题",
            SUBJECTIVE: "解答题",
            MIXED: "综合题",
          }[question.type],
          question: {
            type: question.type,
            subject: question.subject,
            grade: question.grade,
            difficulty: question.difficulty,
            knowledgeTags: question.knowledgeTags,
            content: revisionContent(question.content, imageCopies),
          },
        };
      }),
    },
  });
  return result!;
}

export async function reproducePaper(userId: string, raw: unknown) {
  const input = replayPaperSchema.parse(raw);
  const writtenPaths: string[] = [];
  try {
    return await getDb().$transaction(
      async (db) => {
        await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
        const { state, wrong } = await revisionContext(userId, input, db);
        const selected = uniqueReplayQuestions(wrong);
        if (!selected.length) throw new RequestError(422, "没有可生成复习卷的错题。");
        const result = await saveRevisionPaper(
          db,
          state.actor,
          input,
          selected.map((w) => ({ question: w.question, score: w.maximum })),
          "错题复现卷：请重新独立作答，完成后核对参考答案。",
          writtenPaths,
        );
        return { ...result, count: selected.length };
      },
      { timeout: 60000 },
    );
  } catch (error) {
    await Promise.all(writtenPaths.map((path) => rm(path, { force: true })));
    throw error;
  }
}
