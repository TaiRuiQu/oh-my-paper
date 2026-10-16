import "server-only";
import type { Actor, Paper } from "@/contracts/platform";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/http/errors";
import {
  homeworkCommandSchema,
  homeworkHistoryQuerySchema,
  homeworkListQuerySchema,
  type HomeworkAnswer,
  type HomeworkAssignmentDetail,
  type HomeworkAssignments,
  type HomeworkCommandResult,
  type HomeworkFrozenPaper,
  type HomeworkHistory,
  type HomeworkIssuePreview,
  type HomeworkCollectionCounts,
} from "@/contracts/homework";
import { getActor, json, missing, type Db } from "../access";
import { manageableAssessmentRoster } from "../assessment-roster";
import { paperRecord } from "../records";
import { schoolTimezone } from "../school-timezone";
import { questionAssetUrls } from "@/lib/question-assets";
import { resolveHomeworkDeadline } from "@/lib/homework-time";
import {
  assignmentAccess,
  assignmentDTO,
  attemptSummary,
  canManageHomework,
  frozenPapers,
  homeworkConflict,
  homeworkSummarySelect,
  homeworkWorkScope,
  assignmentSummaryDTO,
  promptImages,
  requireManager,
  requireSynced,
  requireUnpublished,
  visibleWorks,
  workDTO,
  workReasons,
  type AssignmentRow,
  type HomeworkActor,
  type WorkRow,
  promptText,
  effectiveHomeworkDeadline,
} from "./context";

function deadline(dueLocal: string, timezone: string) {
  try {
    return resolveHomeworkDeadline(dueLocal, timezone);
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : "截止时间无效。");
  }
}
function parse<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "作业请求参数无效，请核对填写内容。");
  return parsed.data;
}
async function eventsFor(db: Db, id: string) {
  return db.homeworkEvent.findMany({
    where: { assignmentId: id, type: "homework.return" },
    orderBy: { sequence: "desc" },
  });
}
function counts(works: ReturnType<typeof workDTO>[]): HomeworkCollectionCounts {
  const required = works.filter((w) => w.participationStatus === "REQUIRED");
  return {
    required: required.length,
    submitted: required.filter((w) => w.collectionStatus === "SUBMITTED").length,
    notSubmitted: required.filter((w) => w.collectionStatus === "NOT_SUBMITTED").length,
    returned: required.filter((w) => w.collectionStatus === "RETURNED").length,
    late: required.filter((w) => w.collectionStatus === "SUBMITTED" && w.currentAttempt?.late)
      .length,
    absent: works.filter((w) => w.participationStatus === "ABSENT").length,
    exempt: works.filter((w) => w.participationStatus === "EXEMPT").length,
    withdrawn: works.filter((w) => w.participationStatus === "WITHDRAWN").length,
  };
}
export async function loadHomeworkAssignment(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<HomeworkAssignmentDetail> {
  const current = await getActor(actor.id, db),
    row = await assignmentAccess(db, current, id),
    events = await eventsFor(db, id);
  const works = visibleWorks(current, row),
    assignment = assignmentDTO(current, row);
  if (current.role === "STUDENT")
    return {
      view: "STUDENT",
      actor: current,
      assignment,
      works: works.map((work) => ({
        ...workDTO(current, row, work, events),
        draft: {
          version: work.draftVersion,
          answers: work.draftAnswers as unknown as HomeworkAnswer[],
          updatedAt: work.draftUpdatedAt?.toISOString() ?? null,
        },
      })),
    };
  const paperIds = new Set(works.map((work) => work.participantSubject.paperId));
  const projected = works.map((work) => workDTO(current, row, work, events));
  return {
    view: "TEACHER",
    actor: current,
    assignment,
    fullPapers: frozenPapers(row)
      .filter(({ paper }) => paperIds.has(paper.id))
      .map(({ paper }) => paper),
    works: projected,
    counts: counts(projected),
  };
}
export async function loadHomeworkAssignments(
  actor: Actor,
  input: unknown,
  db: Db = getDb(),
): Promise<HomeworkAssignments> {
  const query = parse(homeworkListQuerySchema, input),
    current = await getActor(actor.id, db);
  const scope = homeworkWorkScope(current);
  const where: Prisma.HomeworkAssignmentWhereInput = {
    works: { some: scope },
    ...(query.status ? { status: query.status } : {}),
    ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
  };
  if (
    query.beforeId &&
    !(await db.homeworkAssignment.findFirst({
      where: { AND: [where, { id: query.beforeId }] },
      select: { id: true },
    }))
  )
    throw homeworkConflict("列表已变化，请重新读取第一页。");
  const rows = await db.homeworkAssignment.findMany({
    where: { ...where, ...(query.beforeId ? { id: { lt: query.beforeId } } : {}) },
    select: { ...homeworkSummarySelect, works: { ...homeworkSummarySelect.works, where: scope } },
    orderBy: { id: "desc" },
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit),
    nextBeforeId = rows.length > query.limit ? page.at(-1)!.id : null;
  const summaries = page.map((row) => {
    const summary = assignmentSummaryDTO(current, row),
      works = visibleWorks(current, row).map((work) => workDTO(current, row, work));
    return { ...summary, works, counts: counts(works) };
  });
  return current.role === "STUDENT"
    ? {
        view: "STUDENT",
        actor: current,
        assignments: summaries.map(({ counts: _counts, ...summary }) => {
          void _counts;
          return summary;
        }),
        nextBeforeId,
      }
    : {
        view: "TEACHER",
        actor: current,
        assignments: summaries.map(({ works: _works, ...summary }) => {
          void _works;
          return summary;
        }),
        nextBeforeId,
      };
}
export async function loadHomeworkIssuePreview(
  actor: Actor,
  assessmentId: string,
  db: Db = getDb(),
): Promise<HomeworkIssuePreview> {
  const current = await getActor(actor.id, db);
  // This helper only reads despite its transaction-client type; use the same authority as roster management.
  const assessment = await manageableAssessmentRoster(
    db as Prisma.TransactionClient,
    current,
    assessmentId,
  );
  const papers = await db.paper.findMany({
    where: { id: { in: assessment.papers.map((p) => p.paperId) } },
  });
  const reasons: string[] = [];
  if (assessment.kind !== "HOMEWORK") reasons.push("仅作业安排可发放线上作业。");
  if (assessment.published) reasons.push("请先撤回成绩发布。");
  if (assessment.rosterStatus !== "CONFIRMED") reasons.push("请先核对确认参试名单。");
  if (!assessment.participants.some((p) => p.subjects.some((s) => s.status === "REQUIRED")))
    reasons.push("至少需要一名本次应交学生。");
  if (await db.homeworkAssignment.findUnique({ where: { assessmentId } }))
    reasons.push("本次作业已经发放，请进入收交页面管理。");
  if (await db.scanSubmission.count({ where: { assessmentId } }))
    reasons.push("已有扫描或人工答卷，不能再切换为线上收交。");
  const unsupportedImage = (text: string) =>
    /<img\b/i.test(text) ||
    [...text.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)|!\[[^\]]*\](?!\()/g)].some(
      (match) => !match[1] || !/^\/api\/platform\/assets\/[a-f0-9-]{36}$/.test(match[1]),
    );
  if (
    papers.some((raw) => {
      const p = paperRecord(raw),
        layout = raw.layout as unknown as Paper["layout"];
      return (
        [p.instructions, ...(layout.textBlocks ?? []).map((block) => block.text)].some(
          unsupportedImage,
        ) ||
        p.items.some((item) => {
          const content = item.snapshot.content;
          return [
            content.stem,
            ...content.options.map((o) => o.text),
            ...content.parts.flatMap((part) => [part.stem, ...part.options.map((o) => o.text)]),
          ].some(unsupportedImage);
        })
      );
    })
  )
    reasons.push(
      "此卷含未支持的外链、引用式或 HTML 图片，请改为上传本站的 Markdown 题面图片后再发放。",
    );
  if (
    papers.length !== assessment.papers.length ||
    papers.some((p) => p.kind !== "HOMEWORK" || !(p.items as unknown[]).length)
  )
    reasons.push("请先完成作业卷内容。");
  return {
    assessmentId,
    timezone: await schoolTimezone(db),
    name: assessment.name,
    rosterRevision: assessment.rosterRevision,
    rosterStatus: assessment.rosterStatus,
    canIssue: !reasons.length,
    blockReasons: reasons,
    papers: papers.map((raw) => {
      const p = paperRecord(raw);
      return {
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt.toISOString(),
        subject: p.subject,
        instructions: p.instructions,
        textBlocks: ((p.layout as unknown as Paper["layout"]).textBlocks ?? []).map((block) => ({
          id: block.id,
          text: block.text,
          ...(block.beforeQuestionId
            ? {
                beforeQuestionId:
                  p.items.find((item) => item.questionId === block.beforeQuestionId)?.id ??
                  block.beforeQuestionId,
              }
            : {}),
        })),
        allowedStudentImageUrls: questionAssetUrls({
          stem: [
            p.instructions,
            ...((p.layout as unknown as Paper["layout"]).textBlocks ?? []).map(
              (block) => block.text,
            ),
          ].join("\n"),
        }),
        suggestedStudentImageUrls: questionAssetUrls({
          stem: [
            p.instructions,
            ...((p.layout as unknown as Paper["layout"]).textBlocks ?? []).map(
              (block) => block.text,
            ),
          ].join("\n"),
        }),
        items: p.items.map((item) => ({
          ...item,
          allowedStudentImageUrls: questionAssetUrls(item.snapshot.content),
          suggestedStudentImageUrls: promptImages(item.snapshot.content),
        })),
      };
    }),
  };
}
async function accessWork(db: Db, actor: HomeworkActor, id: string) {
  const found = await db.homeworkWork.findUnique({ where: { id }, select: { assignmentId: true } });
  if (!found) throw missing();
  const row = await assignmentAccess(db, actor, found.assignmentId),
    work = visibleWorks(actor, row).find((entry) => entry.id === id);
  if (!work) throw missing();
  return { row, work };
}
function assertWorkVersion(work: WorkRow, expected: number) {
  if (work.version !== expected)
    throw homeworkConflict("作答或收交状态已变化，请重新读取；保留本地草稿后再比较。");
}
function studentWrite(
  actor: HomeworkActor,
  row: AssignmentRow,
  work: WorkRow,
  draft: boolean,
  at: Date,
) {
  if (actor.role !== "STUDENT" || work.participantSubject.participant.student.userId !== actor.id)
    throw missing();
  const reasons = workReasons(actor, row, work, { allowUnsyncedDraft: draft, at });
  if (reasons.length) throw homeworkConflict(reasons.join(" "));
}
async function validateAnswers(
  db: Db,
  actor: HomeworkActor,
  row: AssignmentRow,
  work: WorkRow,
  answers: HomeworkAnswer[],
) {
  const paper = frozenPapers(row).find(
    ({ paper }) => paper.id === work.participantSubject.paperId,
  )?.paper;
  if (!paper || answers.some((answer) => !paper.items.some((item) => item.id === answer.itemId)))
    throw new RequestError(400, "作答题目不属于本次发放的作业卷。");
  const urls = [...new Set(answers.flatMap((answer) => answer.images))];
  const links = await db.homeworkAsset.findMany({
    where: { workId: work.id },
    include: { asset: true },
  });
  if (
    urls.some(
      (url) =>
        !links.some(
          (link) =>
            link.uploadedBy === actor.id &&
            link.asset.ownerId === actor.id &&
            url === `/api/platform/assets/${link.assetId}`,
        ),
    )
  )
    throw missing();
}
async function event(
  db: Prisma.TransactionClient,
  actor: HomeworkActor,
  row: { id: string; version: number },
  type: string,
  details: unknown = {},
  reason = "",
  work?: { id: string; version: number },
) {
  await db.homeworkEvent.create({
    data: {
      assignmentId: row.id,
      type,
      actorId: actor.id,
      assignmentVersion: row.version,
      workId: work?.id ?? null,
      workVersion: work?.version ?? null,
      reason,
      details: json(details),
    },
  });
}
export async function executeHomeworkCommand(
  actor: Actor,
  input: unknown,
  context: { db?: Prisma.TransactionClient } = {},
): Promise<HomeworkCommandResult> {
  const command = parse(homeworkCommandSchema, input);
  const execute = async (db: Prisma.TransactionClient): Promise<HomeworkCommandResult> => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    const current = await getActor(actor.id, db);
    const acceptedAt = new Date();
    if (command.type === "homework.issue") {
      const preview = await loadHomeworkIssuePreview(current, command.assessmentId, db);
      if (command.timezone !== preview.timezone)
        throw new RequestError(400, "请使用当前学校时区发放作业，重新预览后再试。");
      if (!preview.canIssue) throw homeworkConflict(preview.blockReasons.join(" "));
      if (preview.rosterRevision !== command.expectedRosterRevision)
        throw homeworkConflict("参试名单已变化，请重新预览发放。");
      if (preview.papers.length !== command.expectedPapers.length)
        throw homeworkConflict("作业卷配置已变化，请重新预览发放。");
      const frozen: HomeworkFrozenPaper[] = [];
      for (const p of preview.papers) {
        const expected = command.expectedPapers.find((e) => e.paperId === p.id);
        if (
          !expected ||
          new Date(expected.expectedUpdatedAt).getTime() !== new Date(p.updatedAt).getTime() ||
          expected.items.length !== p.items.length
        )
          throw homeworkConflict("作业卷已变化，请重新预览并核对学生可见材料。");
        if (
          expected.studentImageUrls.some((url) => !p.allowedStudentImageUrls.includes(url)) ||
          p.suggestedStudentImageUrls.some((url) => !expected.studentImageUrls.includes(url))
        )
          throw new RequestError(400, "请完整发放说明及共享阅读材料中引用的本站配图。");
        for (const url of expected.studentImageUrls) {
          const asset = await db.platformAsset.findUnique({
            where: { id: url.split("/").at(-1)! },
          });
          if (!asset || (current.role !== "ADMIN" && asset.ownerId !== current.id)) throw missing();
        }
        const studentImageUrlsByItem: Record<string, string[]> = {};
        for (const item of p.items) {
          const selected = expected.items.find((i) => i.itemId === item.id);
          if (
            !selected ||
            selected.studentImageUrls.some((url) => !item.allowedStudentImageUrls.includes(url))
          )
            throw new RequestError(400, "学生可见配图必须来自对应题目材料。");
          if (
            promptImages(item.snapshot.content).some(
              (url) => !selected.studentImageUrls.includes(url),
            )
          )
            throw new RequestError(
              400,
              "题干、选项或小问引用的配图必须发放给学生，请核对题面材料。",
            );
          for (const url of selected.studentImageUrls) {
            const asset = await db.platformAsset.findUnique({
              where: { id: url.split("/").at(-1)! },
            });
            if (
              !asset ||
              (!item.snapshot.content.images.includes(url) &&
                asset.ownerId !== item.snapshot.ownerId &&
                asset.ownerId !== current.id)
            )
              throw missing();
          }
          studentImageUrlsByItem[item.id] = selected.studentImageUrls;
        }
        const raw = await db.paper.findUniqueOrThrow({ where: { id: p.id } });
        const paper: Paper = {
          ...paperRecord(raw),
          kind: raw.kind as Paper["kind"],
          layout: raw.layout as unknown as Paper["layout"],
          createdAt: raw.createdAt.toISOString(),
          updatedAt: raw.updatedAt.toISOString(),
        };
        frozen.push({ paper, studentImageUrls: expected.studentImageUrls, studentImageUrlsByItem });
      }
      const dueAt = deadline(command.dueLocal, command.timezone);
      if (dueAt <= new Date()) throw new RequestError(400, "发放截止时间必须晚于当前时间。");
      const assessment = await db.assessment.findUniqueOrThrow({
        where: { id: command.assessmentId },
        include: { participants: { include: { subjects: true } } },
      });
      const row = await db.homeworkAssignment.create({
        data: {
          assessmentId: assessment.id,
          name: assessment.name,
          instructions: command.instructions,
          timezone: command.timezone,
          dueLocal: command.dueLocal,
          dueAt,
          allowLate: command.allowLate,
          rosterRevision: assessment.rosterRevision,
          papers: json(frozen),
          promptAssetUrls: [
            ...new Set(
              frozen.flatMap((p) => [
                ...p.studentImageUrls,
                ...Object.values(p.studentImageUrlsByItem).flat(),
              ]),
            ),
          ],
          issuedBy: current.id,
        },
      });
      for (const participant of assessment.participants)
        for (const subject of participant.subjects.filter((s) =>
          frozen.some(({ paper }) => paper.id === s.paperId),
        ))
          await db.homeworkWork.create({
            data: { assignmentId: row.id, participantSubjectId: subject.id },
          });
      await event(db, current, row, command.type, {
        after: {
          dueLocal: row.dueLocal,
          timezone: row.timezone,
          allowLate: row.allowLate,
          status: row.status,
          instructions: row.instructions,
          rosterRevision: row.rosterRevision,
        },
      });
      return { id: row.id, version: row.version };
    }
    if ("assignmentId" in command) {
      const row = await assignmentAccess(db, current, command.assignmentId);
      requireManager(current, row);
      requireUnpublished(row);
      if (row.version !== command.expectedVersion) throw homeworkConflict();
      if (row.status === "CANCELLED")
        throw homeworkConflict("已取消的作业不能重新收交，请新建安排。");
      let data: Prisma.HomeworkAssignmentUpdateInput;
      if (command.type === "homework.settings")
        data = {
          instructions: command.instructions,
          dueLocal: command.dueLocal,
          dueAt: deadline(command.dueLocal, row.timezone),
          allowLate: command.allowLate,
        };
      else if (command.type === "homework.roster.sync") {
        if (
          row.assessment.rosterStatus !== "CONFIRMED" ||
          row.assessment.rosterRevision !== command.expectedRosterRevision
        )
          throw homeworkConflict("参试名单需要先确认并重新预览。");
        const papers = frozenPapers(row);
        if (
          (row.assessment.papers as unknown as { paperId: string }[]).some(
            (p) => !papers.some(({ paper }) => paper.id === p.paperId),
          )
        )
          throw homeworkConflict("发放后的作业卷不可更换，请新建安排。");
        for (const participant of row.assessment.participants)
          for (const subject of participant.subjects.filter((s) =>
            papers.some(({ paper }) => paper.id === s.paperId),
          ))
            if (!row.works.some((work) => work.participantSubjectId === subject.id))
              await db.homeworkWork.create({
                data: { assignmentId: row.id, participantSubjectId: subject.id },
              });
        data = { rosterRevision: row.assessment.rosterRevision };
      } else if (command.type === "homework.close") {
        if (row.status !== "ISSUED") throw homeworkConflict("作业已停止收交。");
        data = { status: "CLOSED" };
      } else if (command.type === "homework.reopen") {
        if (row.status !== "CLOSED") throw homeworkConflict("仅停止收交的作业可以重新开放。");
        data = { status: "ISSUED" };
      } else {
        data = { status: "CANCELLED" };
        await db.scanSubmission.updateMany({
          where: {
            id: { in: row.works.flatMap((w) => w.attempts.map((a) => a.submissionId)) },
            active: true,
          },
          data: { active: false },
        });
      }
      const before = {
        dueLocal: row.dueLocal,
        timezone: row.timezone,
        allowLate: row.allowLate,
        instructions: row.instructions,
        status: row.status,
        rosterRevision: row.rosterRevision,
      };
      const updated = await db.homeworkAssignment.update({
        where: { id: row.id },
        data: { ...data, version: { increment: 1 } },
      });
      await event(
        db,
        current,
        updated,
        command.type,
        {
          before,
          after: {
            dueLocal: updated.dueLocal,
            timezone: updated.timezone,
            allowLate: updated.allowLate,
            instructions: updated.instructions,
            status: updated.status,
            rosterRevision: updated.rosterRevision,
          },
        },
        command.reason,
      );
      return { id: row.id, version: updated.version };
    }
    const { row, work } = await accessWork(db, current, command.workId);
    if (command.type === "homework.submit") {
      // A successful request is replayable even after its version advanced. No fresh draft is adopted.
      const existing = await db.homeworkAttempt.findUnique({
        where: { workId_requestId: { workId: work.id, requestId: command.requestId } },
      });
      if (existing) {
        if (current.role !== "STUDENT" || existing.submittedBy !== current.id) throw missing();
        const receipt = await db.homeworkEvent.findFirst({
          where: {
            workId: work.id,
            type: "homework.submit",
            details: { path: ["attemptId"], equals: existing.id },
          },
        });
        const base = receipt?.details as
          { draftVersion?: number; expectedRosterRevision?: number } | undefined;
        if (
          !receipt ||
          receipt.workVersion !== command.expectedVersion + 1 ||
          receipt.assignmentVersion !== command.expectedAssignmentVersion ||
          base?.draftVersion !== command.expectedDraftVersion ||
          base?.expectedRosterRevision !== command.expectedRosterRevision
        )
          throw homeworkConflict("该提交编号已用于另一份提交请求，请核对原回执。");
        return {
          id: row.id,
          version: receipt.assignmentVersion,
          workId: work.id,
          workVersion: receipt.workVersion!,
          draftVersion: base!.draftVersion!,
          attemptId: existing.id,
          sequence: existing.sequence,
        };
      }
    }
    assertWorkVersion(work, command.expectedVersion);
    if (command.type === "homework.draft.save" || command.type === "homework.submit") {
      studentWrite(current, row, work, command.type === "homework.draft.save", acceptedAt);
      if (work.draftVersion !== command.expectedDraftVersion)
        throw homeworkConflict("草稿已由另一页面更新，请先重新读取并比较。");
      const answers =
        command.type === "homework.draft.save"
          ? command.answers
          : (work.draftAnswers as unknown as HomeworkAnswer[]);
      await validateAnswers(db, current, row, work, answers);
      if (command.type === "homework.draft.save") {
        const updated = await db.homeworkWork.update({
          where: { id: work.id },
          data: {
            draftAnswers: json(answers),
            draftUpdatedAt: acceptedAt,
            draftVersion: { increment: 1 },
            version: { increment: 1 },
          },
        });
        // No draft contents enter the shared audit/history stream.
        return {
          id: row.id,
          version: row.version,
          workId: work.id,
          workVersion: updated.version,
          draftVersion: updated.draftVersion,
        };
      }
      if (
        row.version !== command.expectedAssignmentVersion ||
        row.assessment.rosterRevision !== command.expectedRosterRevision
      )
        throw homeworkConflict("作业安排或名单已变化，请重新读取并核对。");
      requireSynced(row);
      const sequence = Math.max(0, ...work.attempts.map((a) => a.sequence)) + 1;
      // Only one source remains eligible for grading and formal analytics.
      if (work.currentAttemptId)
        await db.scanSubmission.updateMany({
          where: { id: { in: work.attempts.map((a) => a.submissionId) }, active: true },
          data: { active: false },
        });
      const submission = await db.scanSubmission.create({
        data: {
          ownerId: row.assessment.ownerId,
          assessmentId: row.assessmentId,
          paperId: work.participantSubject.paperId,
          studentId: work.participantSubject.participant.studentId,
          kind: "WORKBOOK",
          status: "PENDING",
          sourceFiles: [...new Set(answers.flatMap((a) => a.images))],
          answers: json(answers),
          attemptNumber: sequence,
          active: true,
        },
      });
      const attempt = await db.homeworkAttempt.create({
        data: {
          workId: work.id,
          sequence,
          requestId: command.requestId,
          submissionId: submission.id,
          submittedBy: current.id,
          late: acceptedAt > effectiveHomeworkDeadline(row, work).at,
          submittedAt: acceptedAt,
        },
      });
      const updated = await db.homeworkWork.update({
        where: { id: work.id },
        data: {
          currentAttemptId: attempt.id,
          collectionStatus: "SUBMITTED",
          version: { increment: 1 },
        },
      });
      await event(
        db,
        current,
        row,
        command.type,
        {
          attemptId: attempt.id,
          sequence,
          late: attempt.late,
          draftVersion: work.draftVersion,
          expectedRosterRevision: command.expectedRosterRevision,
        },
        "",
        updated,
      );
      return {
        id: row.id,
        version: row.version,
        workId: work.id,
        workVersion: updated.version,
        draftVersion: updated.draftVersion,
        attemptId: attempt.id,
        sequence,
      };
    }
    requireManager(current, row);
    requireUnpublished(row);
    if (row.status === "CANCELLED") throw homeworkConflict("作业已取消，不能调整收交。");
    if (command.type === "homework.return") {
      const attempt = work.attempts.find(
        (a) => a.id === command.expectedAttemptId && a.id === work.currentAttemptId,
      );
      if (work.collectionStatus !== "SUBMITTED" || !attempt?.submission.active)
        throw homeworkConflict("当前提交已变化，请重新读取后再退回。");
      await db.scanSubmission.update({
        where: { id: attempt.submissionId },
        data: { active: false },
      });
      const updated = await db.homeworkWork.update({
        where: { id: work.id },
        data: { collectionStatus: "RETURNED", version: { increment: 1 } },
      });
      await event(
        db,
        current,
        row,
        command.type,
        { attemptId: attempt.id, sequence: attempt.sequence },
        command.reason,
        updated,
      );
      return { id: row.id, version: row.version, workId: work.id, workVersion: updated.version };
    }
    const dueAt = deadline(command.dueLocal, row.timezone);
    if (dueAt <= new Date() || dueAt <= effectiveHomeworkDeadline(row, work).at)
      throw new RequestError(400, "延期时间必须晚于当前时间及现有截止时间。");
    const updated = await db.homeworkWork.update({
      where: { id: work.id },
      data: {
        dueAtOverride: dueAt,
        dueLocalOverride: command.dueLocal,
        extensionReason: command.reason,
        version: { increment: 1 },
      },
    });
    await event(
      db,
      current,
      row,
      command.type,
      { dueLocal: command.dueLocal },
      command.reason,
      updated,
    );
    return { id: row.id, version: row.version, workId: work.id, workVersion: updated.version };
  };
  return context.db ? execute(context.db) : getDb().$transaction(execute, { timeout: 30000 });
}

export async function loadHomeworkHistory(
  actor: Actor,
  assignmentId: string,
  input: unknown,
  db: Db = getDb(),
): Promise<HomeworkHistory> {
  const query = parse(homeworkHistoryQuerySchema, input),
    current = await getActor(actor.id, db),
    row = await assignmentAccess(db, current, assignmentId);
  const works = visibleWorks(current, row).filter(
    (work) => !query.workId || work.id === query.workId,
  );
  if (query.workId && !works.length) throw missing();
  const ids = new Set(works.map((work) => work.id)),
    manager = canManageHomework(current, row);
  const eventScope: Prisma.HomeworkEventWhereInput = {
    assignmentId,
    OR: [
      { workId: { in: [...ids] } },
      {
        workId: null,
        ...(manager && !query.workId
          ? {}
          : {
              type: {
                in: [
                  "homework.issue",
                  "homework.settings",
                  "homework.close",
                  "homework.reopen",
                  "homework.cancel",
                ],
              },
            }),
      },
    ],
  };
  const cursor = query.beforeId
    ? await db.homeworkEvent.findFirst({
        where: { AND: [eventScope, { id: query.beforeId }] },
        select: { sequence: true },
      })
    : null;
  if (query.beforeId && !cursor) throw homeworkConflict("历史分页已变化，请重新读取第一页。");
  const rows = await db.homeworkEvent.findMany({
    where: { ...eventScope, ...(cursor ? { sequence: { lt: cursor.sequence } } : {}) },
    orderBy: { sequence: "desc" },
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit),
    pageAttemptIds = [
      ...new Set(
        page
          .map((event) => (event.details as { attemptId?: string })?.attemptId)
          .filter((id): id is string => !!id),
      ),
    ];
  const attempts = await db.homeworkAttempt.findMany({
    where: { id: { in: pageAttemptIds }, workId: { in: [...ids] } },
    include: { submission: { select: { active: true, answers: true } } },
    orderBy: { sequence: "desc" },
  });
  const returns = pageAttemptIds.length
    ? await db.homeworkEvent.findMany({
        where: {
          assignmentId,
          workId: { in: [...ids] },
          type: "homework.return",
          OR: pageAttemptIds.map((id) => ({ details: { path: ["attemptId"], equals: id } })),
        },
        orderBy: { sequence: "desc" },
      })
    : [];
  const actors = await db.user.findMany({
    where: { id: { in: [...new Set(page.map((event) => event.actorId))] } },
    select: { id: true, name: true },
  });
  return {
    assignmentId,
    events: page.map((event) => ({
      id: event.id,
      assignmentId,
      workId: event.workId,
      type: event.type as HomeworkHistory["events"][number]["type"],
      actorId: event.actorId,
      actorName: actors.find((actor) => actor.id === event.actorId)?.name ?? "已移除账号",
      createdAt: event.createdAt.toISOString(),
      reason: event.reason,
      changes: historyChanges(event),
    })),
    attempts: attempts.map((attempt) => {
      const work = works.find((work) => work.id === attempt.workId)!;
      const paper = frozenPapers(row).find(
        (entry) => entry.paper.id === work.participantSubject.paperId,
      )?.paper;
      if (!paper) throw homeworkConflict("原始作业试卷缺失，暂时无法定位提交记录的题号。");
      const submitted = new Map(
        (attempt.submission.answers as unknown as HomeworkAnswer[]).map((answer) => [
          answer.itemId,
          answer,
        ]),
      );
      return {
        ...attemptSummary(work, attempt, returns),
        workId: attempt.workId,
        paperId: paper.id,
        paperName: paper.name,
        answers: paper.items.map((item, index) => {
          const answer = submitted.get(item.id);
          return {
            itemId: item.id,
            questionNumber: index + 1,
            submitted: !!answer,
            text: answer?.text ?? "",
            images: answer?.images ?? [],
          };
        }),
      };
    }),
    nextBeforeId: rows.length > query.limit ? page.at(-1)!.id : null,
  };
}

function historyChanges(event: { type: string; details: unknown }): string[] {
  const details = event.details as {
    sequence?: number;
    dueLocal?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  if (event.type === "homework.submit") return [`第${details.sequence ?? ""}次提交`];
  if (event.type === "homework.return") return ["本次作答已退回，原记录保留且不再参与评分汇总"];
  if (event.type === "homework.deadline.extend") return [`截止时间调整为${details.dueLocal ?? ""}`];
  const names: Record<string, string> = {
    dueLocal: "截止时间",
    timezone: "学校时区",
    allowLate: "允许迟交",
    instructions: "作业说明",
    status: "收交状态",
    rosterRevision: "已同步名单版本",
  };
  const display = (key: string, value: unknown) =>
    key === "allowLate"
      ? value
        ? "允许"
        : "不允许"
      : key === "status"
        ? ({ ISSUED: "收交中", CLOSED: "停止收交", CANCELLED: "已取消" }[String(value)] ??
          String(value))
        : promptText(String(value ?? ""), []);
  return Object.entries(details.after ?? {})
    .filter(([key, value]) => key in names && (!details.before || details.before[key] !== value))
    .map(([key, value]) =>
      details.before
        ? `${names[key]}：${display(key, details.before[key])} → ${display(key, value)}`
        : `${names[key]}：${display(key, value)}`,
    );
}
