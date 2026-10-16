import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PlatformState } from "@/contracts/platform";
import type {
  HomeworkAssignment,
  HomeworkFrozenPaper,
  HomeworkStudentPaper,
  HomeworkWork,
  HomeworkAttemptSummary,
} from "@/contracts/homework";
import { canReadSubject } from "@/contracts/permissions";
import { RequestError } from "@/server/http/errors";
import { missing, type Db } from "../access";
import { questionAssetUrls } from "@/lib/question-assets";
export const participantInclude = {
  student: { select: { userId: true } },
  classroom: { select: { id: true, stage: true, cohort: true } },
} as const;
export const homeworkWorkSelect = {
  id: true,
  assignmentId: true,
  participantSubjectId: true,
  version: true,
  draftVersion: true,
  draftUpdatedAt: true,
  collectionStatus: true,
  dueAtOverride: true,
  dueLocalOverride: true,
  extensionReason: true,
  currentAttemptId: true,
  updatedAt: true,
  participantSubject: { include: { participant: { include: participantInclude } } },
  attempts: {
    where: { currentForWork: { isNot: null } },
    select: {
      id: true,
      workId: true,
      sequence: true,
      requestId: true,
      submissionId: true,
      submittedBy: true,
      submittedAt: true,
      late: true,
      submission: { select: { active: true } },
    },
    orderBy: { sequence: "desc" as const },
  },
} satisfies Prisma.HomeworkWorkSelect;
export const homeworkInclude = {
  assessment: { include: { participants: { include: { subjects: true, ...participantInclude } } } },
  works: { select: homeworkWorkSelect },
} satisfies Prisma.HomeworkAssignmentInclude;
export type WorkRow = Prisma.HomeworkWorkGetPayload<{ select: typeof homeworkWorkSelect }> & {
  draftAnswers?: Prisma.JsonValue;
};
export type AssignmentRow = Omit<
  Prisma.HomeworkAssignmentGetPayload<{ include: typeof homeworkInclude }>,
  "works"
> & { works: WorkRow[] };
export type AssignmentMetadata = Omit<AssignmentRow, "papers">;
/** Use current classroom directories for authority; participant snapshots are display-only. */
export function homeworkWorkScope(actor: PlatformState["actor"]): Prisma.HomeworkWorkWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "STUDENT")
    return { participantSubject: { participant: { student: { userId: actor.id } } } };
  return {
    OR: (actor.teachingAssignments ?? []).map((grant): Prisma.HomeworkWorkWhereInput => {
      if (grant.role === "SCHOOL_ADMIN") return {};
      if (grant.role === "GRADE_DIRECTOR")
        return {
          participantSubject: {
            participant: { classroom: { stage: grant.stage, cohort: grant.cohort } },
          },
        };
      return {
        participantSubject: {
          participant: { classroomId: grant.classroomId },
          ...(grant.role === "SUBJECT_TEACHER" ? { paper: { subject: grant.subject } } : {}),
        },
      };
    }),
  };
}
export const homeworkSummarySelect = {
  id: true,
  assessmentId: true,
  version: true,
  status: true,
  name: true,
  instructions: true,
  timezone: true,
  dueLocal: true,
  dueAt: true,
  allowLate: true,
  rosterRevision: true,
  issuedBy: true,
  issuedAt: true,
  updatedAt: true,
  promptAssetUrls: true,
  assessment: homeworkInclude.assessment,
  works: homeworkInclude.works,
} satisfies Prisma.HomeworkAssignmentSelect;
export type HomeworkActor = PlatformState["actor"];
export const homeworkConflict = (
  message = "作业版本已变化，请重新读取并核对；本次修改没有保存。",
) => new RequestError(409, message);
export function frozenPapers(row: Pick<AssignmentRow, "papers">) {
  return row.papers as unknown as HomeworkFrozenPaper[];
}
export function teacherCanRead(actor: HomeworkActor, row: AssignmentMetadata, work: WorkRow) {
  if (actor.role === "STUDENT") return false;
  const p = work.participantSubject.participant;
  const paper = (row.assessment.papers as unknown as { paperId: string; subject: string }[]).find(
    (entry) => entry.paperId === work.participantSubject.paperId,
  );
  return !!paper && canReadSubject(actor, p.classroom, paper.subject);
}
export function visibleWorks(actor: HomeworkActor, row: AssignmentMetadata) {
  return row.works.filter((work) =>
    actor.role === "STUDENT"
      ? work.participantSubject.participant.student.userId === actor.id
      : teacherCanRead(actor, row, work),
  );
}
export async function assignmentAccess(db: Db, actor: HomeworkActor, id: string) {
  const row = await db.homeworkAssignment.findUnique({
    where: { id },
    include: {
      ...homeworkInclude,
      works: {
        where: homeworkWorkScope(actor),
        select: {
          ...homeworkWorkSelect,
          ...(actor.role === "STUDENT" ? { draftAnswers: true } : {}),
        },
      },
    },
  });
  if (!row || !visibleWorks(actor, row).length) throw missing();
  return row;
}
export function canManageHomework(actor: HomeworkActor, row: AssignmentMetadata) {
  if (actor.role === "STUDENT" || (actor.role !== "ADMIN" && row.assessment.ownerId !== actor.id))
    return false;
  const participants = row.assessment.participants;
  return participants.every((p) =>
    (row.assessment.papers as unknown as { subject: string }[]).every((paper) =>
      canReadSubject(actor, p.classroom, paper.subject),
    ),
  );
}
export function requireManager(actor: HomeworkActor, row: AssignmentMetadata) {
  if (!canManageHomework(actor, row)) throw missing();
}
export function requireUnpublished(row: AssignmentMetadata) {
  if (row.assessment.published) throw homeworkConflict("请先撤回成绩发布，再调整收交安排。");
}
export function requireSynced(row: AssignmentMetadata) {
  if (
    row.assessment.rosterStatus !== "CONFIRMED" ||
    row.rosterRevision !== row.assessment.rosterRevision
  )
    throw homeworkConflict("参试名单已变化或待确认，请教师先核对并同步收交名单。");
}
export function effectiveHomeworkDeadline(
  row: Pick<AssignmentMetadata, "dueAt" | "dueLocal">,
  work: Pick<WorkRow, "dueAtOverride" | "dueLocalOverride">,
) {
  const override = work.dueAtOverride !== null && work.dueAtOverride > row.dueAt;
  return {
    at: override ? work.dueAtOverride! : row.dueAt,
    local: override ? work.dueLocalOverride! : row.dueLocal,
    override,
  };
}
export function workReasons(
  actor: HomeworkActor,
  row: AssignmentMetadata,
  work: WorkRow,
  options: { allowUnsyncedDraft?: boolean; at?: Date } = {},
) {
  const now = options.at ?? new Date();
  const reasons: string[] = [];
  if (row.assessment.published) reasons.push("成绩已发布，请先撤回发布。");
  if (row.status !== "ISSUED")
    reasons.push(
      row.status === "CANCELLED" ? "本次作业已取消。" : "本次作业已停止收交，请联系教师重新开放。",
    );
  if (
    !options.allowUnsyncedDraft &&
    (row.assessment.rosterStatus !== "CONFIRMED" ||
      row.rosterRevision !== row.assessment.rosterRevision)
  )
    reasons.push("参试名单需要教师核对并同步。");
  if (work.participantSubject.status !== "REQUIRED")
    reasons.push("本次科目已登记缺考、免考或退出，保留记录仅供查看。");
  if (actor.role === "STUDENT" && work.participantSubject.participant.student.userId !== actor.id)
    reasons.push("这不是当前账号的作业。");
  if (work.collectionStatus === "SUBMITTED")
    reasons.push("本次作答已经提交；教师退回后才能修改重交。");
  const dueAt = effectiveHomeworkDeadline(row, work).at;
  if (now > dueAt && !row.allowLate) reasons.push("已过截止时间，请联系教师延期后提交。");
  return reasons;
}
/** Strip arbitrary remote/solution image links as well as hidden answer fields. */
export function promptText(text: string, selected: string[]) {
  const allowed = new Set(selected);
  return text
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (all, alt: string, url: string) =>
      allowed.has(url) ? all : alt ? `[${alt}]` : "",
    )
    .replace(/\/api\/platform\/assets\/[a-f0-9-]{36}/g, (url) =>
      allowed.has(url) ? url : "[材料未发放]",
    );
}
export function studentPaper(frozen: HomeworkFrozenPaper): HomeworkStudentPaper {
  const { paper, studentImageUrlsByItem, studentImageUrls } = frozen;
  return {
    id: paper.id,
    name: paper.name,
    subject: paper.subject,
    instructions: promptText(paper.instructions, studentImageUrls),
    textBlocks: (paper.layout.textBlocks ?? []).map((block) => ({
      id: block.id,
      text: promptText(block.text, studentImageUrls),
      ...(block.beforeQuestionId
        ? {
            beforeQuestionId:
              paper.items.find((item) => item.questionId === block.beforeQuestionId)?.id ??
              block.beforeQuestionId,
          }
        : {}),
    })),
    studentImageUrls,
    items: paper.items.map((item) => {
      const content = item.snapshot.content,
        partWeight = content.parts.reduce((sum, part) => sum + part.score, 0),
        selected = studentImageUrlsByItem[item.id] ?? [];
      return {
        id: item.id,
        position: item.position,
        score: item.score,
        section: item.section,
        type: item.snapshot.type,
        stem: promptText(content.stem, selected),
        options: content.options.map((o) => ({
          label: o.label,
          text: promptText(o.text, selected),
        })),
        parts: content.parts.map((p) => ({
          id: p.id,
          type: p.type,
          score: partWeight ? (item.score * p.score) / partWeight : 0,
          stem: promptText(p.stem, selected),
          options: p.options.map((o) => ({ label: o.label, text: promptText(o.text, selected) })),
        })),
        studentImageUrls: selected,
      };
    }),
  };
}
export function promptImages(content: Parameters<typeof questionAssetUrls>[0]) {
  const value = content as {
    stem: string;
    options: unknown[];
    parts: { stem: string; options: unknown[] }[];
  };
  return questionAssetUrls({
    stem: value.stem,
    options: value.options,
    parts: value.parts.map((p) => ({ stem: p.stem, options: p.options })),
  });
}
export function assignmentSummaryDTO(
  actor: HomeworkActor,
  row: AssignmentMetadata,
): Omit<HomeworkAssignment, "papers"> {
  const manage = canManageHomework(actor, row),
    unpublished = !row.assessment.published,
    cancelled = row.status === "CANCELLED";
  const blockReasons = [
    ...(!manage ? ["仅创建者或管理员在拥有完整班级学科权限时可管理收交。"] : []),
    ...(!unpublished ? ["成绩已发布，请先撤回发布。"] : []),
    ...(cancelled ? ["作业已取消，历史记录保留。"] : []),
  ];
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    name: row.name,
    version: row.version,
    status: row.status as HomeworkAssignment["status"],
    issuedAt: row.issuedAt.toISOString(),
    dueLocal: row.dueLocal,
    dueAt: row.dueAt.toISOString(),
    timezone: row.timezone,
    allowLate: row.allowLate,
    instructions: promptText(row.instructions, []),
    resultsPublished: row.assessment.published && row.assessment.rosterStatus === "CONFIRMED",
    rosterRevision: row.rosterRevision,
    currentRosterRevision: row.assessment.rosterRevision,
    rosterNeedsSync:
      row.assessment.rosterStatus !== "CONFIRMED" ||
      row.rosterRevision !== row.assessment.rosterRevision,
    capabilities: {
      canManage: manage && unpublished && !cancelled,
      canClose: manage && unpublished && row.status === "ISSUED",
      canReopen: manage && unpublished && row.status === "CLOSED",
      canCancel: manage && unpublished && !cancelled,
      canSyncRoster:
        manage && unpublished && !cancelled && row.assessment.rosterStatus === "CONFIRMED",
      canViewHistory: true,
      blockReasons,
    },
  };
}
export function assignmentDTO(actor: HomeworkActor, row: AssignmentRow): HomeworkAssignment {
  const ids = new Set(
    visibleWorks(actor, row)
      .filter(
        (w) =>
          actor.role !== "STUDENT" ||
          (row.status !== "CANCELLED" && w.participantSubject.status === "REQUIRED"),
      )
      .map((w) => w.participantSubject.paperId),
  );
  return {
    ...assignmentSummaryDTO(actor, row),
    papers: frozenPapers(row)
      .filter((p) => ids.has(p.paper.id))
      .map(studentPaper),
  };
}
export function attemptSummary(
  work: WorkRow,
  attempt: WorkRow["attempts"][number],
  events: { type: string; details: unknown; createdAt: Date; reason: string }[] = [],
): HomeworkAttemptSummary {
  const returned = events.find(
    (e) =>
      e.type === "homework.return" &&
      (e.details as { attemptId?: string })?.attemptId === attempt.id,
  );
  return {
    id: attempt.id,
    scanSubmissionId: attempt.submissionId,
    sequence: attempt.sequence,
    submittedAt: attempt.submittedAt.toISOString(),
    late: attempt.late,
    source: "STUDENT",
    status:
      returned || (work.collectionStatus === "RETURNED" && work.currentAttemptId === attempt.id)
        ? "RETURNED"
        : "SUBMITTED",
    returnedAt: returned?.createdAt.toISOString() ?? null,
    returnReason: returned?.reason ?? "",
  };
}
export function workDTO(
  actor: HomeworkActor,
  row: AssignmentMetadata,
  work: WorkRow,
  events: Parameters<typeof attemptSummary>[2] = [],
): HomeworkWork {
  const p = work.participantSubject.participant,
    reasons = workReasons(actor, row, work),
    student = actor.role === "STUDENT" && p.student.userId === actor.id;
  const manage =
    canManageHomework(actor, row) && !row.assessment.published && row.status !== "CANCELLED";
  const current = work.attempts.find((a) => a.id === work.currentAttemptId);
  const effective = effectiveHomeworkDeadline(row, work),
    due = effective.at;
  return {
    id: work.id,
    participantSubjectId: work.participantSubjectId,
    paperId: work.participantSubject.paperId,
    version: work.version,
    studentId: p.studentId,
    name: p.name,
    studentNumber: p.studentNumber,
    classroomId: p.classroomId,
    classroomName: p.classroomName,
    participationStatus: work.participantSubject.status as HomeworkWork["participationStatus"],
    participationReason: work.participantSubject.reason,
    collectionStatus: work.collectionStatus as HomeworkWork["collectionStatus"],
    dueAt: due.toISOString(),
    dueLocal: effective.local,
    deadlineOverride: effective.override
      ? {
          dueAt: effective.at.toISOString(),
          dueLocal: work.dueLocalOverride!,
          reason: work.extensionReason,
        }
      : null,
    overdue: new Date() > due,
    currentAttempt: current ? attemptSummary(work, current, events) : null,
    capabilities: {
      canSaveDraft: student && !workReasons(actor, row, work, { allowUnsyncedDraft: true }).length,
      canSubmit: student && !reasons.length,
      canUpload: student && !reasons.length,
      canReturn: manage && work.collectionStatus === "SUBMITTED" && !!current?.submission.active,
      canExtend: manage,
      canViewAttemptHistory: true,
      blockReasons: reasons,
    },
  };
}
