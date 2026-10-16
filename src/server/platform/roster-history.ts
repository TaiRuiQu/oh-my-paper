import "server-only";
import { z } from "zod";
import type { Actor, AssessmentParticipant, ParticipationStatus } from "@/contracts/platform";
import type { RosterHistory, RosterHistoryEntry } from "@/contracts/assessment-roster-history";
import { rosterHistoryQuerySchema } from "@/contracts/assessment-roster-history";
import { canReadSubject } from "@/contracts/permissions";
import { AccessError, RequestError } from "@/server/http/errors";
import { getDb } from "@/server/db/client";
import { getActor, missing, visibleClassrooms, type Db } from "./access";
import { assessmentRecord } from "./records";
import { rosterInclude } from "./assessment-roster";

const status = z.enum(["REQUIRED", "ABSENT", "EXEMPT", "WITHDRAWN"]);
const subject = z.object({ paperId: z.string(), status, reason: z.string().default("") });
const participant = z.object({
  id: z.string(),
  studentId: z.string(),
  name: z.string(),
  studentNumber: z.string(),
  classroomId: z.string(),
  classroomName: z.string(),
  subjects: z.array(subject),
});
const eventData = z.object({
  source: z.string().optional(),
  requiresReview: z.boolean().optional(),
  added: z.array(participant).default([]),
  changes: z
    .array(
      z.object({
        participantId: z.string(),
        studentId: z.string(),
        paperId: z.string(),
        before: subject,
        after: z.object({ status, reason: z.string() }),
      }),
    )
    .default([]),
  confirmReconstruction: z.boolean().default(false),
  before: z.array(participant).optional(),
  selectedStudentIds: z.array(z.string()).optional(),
  paperIds: z.array(z.string()).optional(),
});

/** Return semantic entries only; raw audit snapshots must never cross the current scope boundary. */
export async function loadRosterHistory(
  actor: Actor,
  input: unknown,
  db: Db = getDb(),
): Promise<RosterHistory> {
  const parsed = rosterHistoryQuerySchema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "名单历史查询参数无效。");
  const query = parsed.data;
  const current = await getActor(actor.id, db);
  if (current.role === "STUDENT") throw new AccessError(403, "学生不能查看参与名单变更历史。");
  const row = await db.assessment.findUnique({
    where: { id: query.assessmentId },
    include: rosterInclude,
  });
  if (!row) throw missing();
  const assessment = assessmentRecord(row);
  const classrooms = await db.classroom.findMany({ where: visibleClassrooms(current) });
  const canRead = (classroomId: string, subjectName: string) => {
    const classroom = classrooms.find((entry) => entry.id === classroomId);
    return !!classroom && canReadSubject(current, classroom, subjectName);
  };
  if (
    !assessment.classroomIds.some((id) =>
      assessment.papers.some((paper) => canRead(id, paper.subject)),
    )
  )
    throw missing();
  let scopeRestricted = [
    ...new Set([
      ...assessment.classroomIds,
      ...assessment.participants.map((entry) => entry.classroomId),
    ]),
  ].some((id) => assessment.papers.some((paper) => !canRead(id, paper.subject)));
  const rawEvents = await db.assessmentRosterEvent.findMany({
    where: {
      assessmentId: assessment.id,
      ...(query.beforeRevision ? { revision: { lt: query.beforeRevision } } : {}),
    },
    orderBy: { revision: "desc" },
    take: query.limit + 1,
  });
  const page = rawEvents.slice(0, query.limit);
  const decoded = page.map((event) => ({ event, data: eventData.parse(event.changes) }));
  const paperIds = new Set(
    assessment.participants.flatMap((entry) => entry.subjects.map((value) => value.paperId)),
  );
  for (const { data } of decoded) {
    for (const entry of [...data.added, ...(data.before ?? [])])
      for (const value of entry.subjects) paperIds.add(value.paperId);
    for (const entry of data.changes) paperIds.add(entry.paperId);
    for (const paperId of data.paperIds ?? []) paperIds.add(paperId);
  }
  const papers = await db.paper.findMany({
    where: { id: { in: [...paperIds] } },
    select: { id: true, subject: true },
  });
  const subjects = new Map(papers.map((paper) => [paper.id, paper.subject]));
  scopeRestricted ||= assessment.participants.some((member) =>
    member.subjects.some(
      (entry) =>
        !subjects.has(entry.paperId) || !canRead(member.classroomId, subjects.get(entry.paperId)!),
    ),
  );
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(page.map((event) => event.actorId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((user) => [user.id, user.name]));
  const participants = new Map(assessment.participants.map((entry) => [entry.studentId, entry]));
  const events: RosterHistory["events"] = [];
  for (const { event, data } of decoded) {
    const entries: RosterHistoryEntry[] = [];
    let hidden = false;
    const add = (
      member: Pick<
        AssessmentParticipant,
        "studentId" | "name" | "studentNumber" | "classroomId" | "classroomName"
      >,
      paperId: string,
      beforeStatus: ParticipationStatus | null,
      after: ParticipationStatus,
      reason: string,
    ) => {
      const subjectName = subjects.get(paperId);
      if (!subjectName || !canRead(member.classroomId, subjectName)) {
        hidden = true;
        return;
      }
      entries.push({
        studentId: member.studentId,
        name: member.name,
        studentNumber: member.studentNumber,
        classroomId: member.classroomId,
        classroomName: member.classroomName,
        paperId,
        subject: subjectName,
        beforeStatus,
        status: after,
        reason,
        kind: beforeStatus === null ? "ADDED" : "STATUS_CHANGED",
      });
    };
    for (const member of data.added)
      for (const value of member.subjects)
        add(member, value.paperId, null, value.status, value.reason || event.reason);
    for (const change of data.changes) {
      const member = participants.get(change.studentId);
      if (member)
        add(member, change.paperId, change.before.status, change.after.status, change.after.reason);
    }
    if (data.before && data.selectedStudentIds && data.paperIds) {
      const before = new Map(data.before.map((entry) => [entry.studentId, entry]));
      for (const member of data.before) {
        for (const value of member.subjects) {
          if (
            value.status !== "WITHDRAWN" &&
            (!data.selectedStudentIds.includes(member.studentId) ||
              !data.paperIds.includes(value.paperId))
          )
            add(member, value.paperId, value.status, "WITHDRAWN", event.reason);
        }
      }
      for (const studentId of data.selectedStudentIds) {
        const member = before.get(studentId) ?? participants.get(studentId);
        if (!member) continue;
        for (const paperId of data.paperIds)
          if (!before.get(studentId)?.subjects.some((value) => value.paperId === paperId))
            add(member, paperId, null, "REQUIRED", event.reason);
      }
    }
    const reconstructedCandidate =
      data.source === "MIGRATION_RECONSTRUCTION" && data.requiresReview === true;
    // Global reconstruction metadata is visible only to complete-scope readers.
    if (
      !entries.length &&
      !((data.confirmReconstruction || reconstructedCandidate || data.before) && !scopeRestricted)
    )
      continue;
    const restrictedEvent = hidden || scopeRestricted;
    events.push({
      id: event.id,
      revision: event.revision,
      createdAt: event.createdAt.toISOString(),
      actorName:
        event.actorId === "system:migration"
          ? "系统迁移"
          : (names.get(event.actorId) ?? "已删除账号"),
      reason: restrictedEvent ? "仅显示当前授权范围内的变更，整体原因不展示。" : event.reason,
      confirmedReconstruction: data.confirmReconstruction && !scopeRestricted,
      reconstructedCandidate: reconstructedCandidate && !scopeRestricted,
      entries: entries.map((entry) => ({
        ...entry,
        reason:
          restrictedEvent && (data.before || data.added.length)
            ? "范围调整原因仅对完整授权者显示。"
            : entry.reason,
      })),
    });
  }
  return {
    assessmentId: assessment.id,
    currentRevision: assessment.rosterRevision,
    scopeRestricted,
    events,
    nextBeforeRevision: rawEvents.length > query.limit ? page.at(-1)!.revision : null,
  };
}
