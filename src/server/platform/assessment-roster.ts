import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AssessmentPaper, PlatformState } from "@/contracts/platform";
import { canReadSubject } from "@/contracts/permissions";
import { RequestError } from "@/server/http/errors";
import { json, missing, owner, visibleClassrooms } from "./access";
import { assessmentRecord } from "./records";

export const rosterInclude = { participants: { include: { subjects: true } } } as const;

export async function manageableAssessmentRoster(
  db: Prisma.TransactionClient,
  actor: PlatformState["actor"],
  id: string,
) {
  const row = owner(
    actor,
    await db.assessment.findUnique({ where: { id }, include: rosterInclude }),
  );
  const assessment = assessmentRecord(row);
  const ids = [
    ...new Set([
      ...assessment.classroomIds,
      ...assessment.participants.map((participant) => participant.classroomId),
    ]),
  ];
  const classes = await db.classroom.findMany({
    where: { AND: [{ id: { in: ids } }, visibleClassrooms(actor)] },
  });
  if (
    classes.length !== ids.length ||
    classes.some((classroom) =>
      assessment.papers.some((paper) => !canReadSubject(actor, classroom, paper.subject)),
    )
  )
    throw missing();
  return assessment;
}

export async function addRosterParticipants(
  db: Prisma.TransactionClient,
  assessmentId: string,
  classroomIds: string[],
  papers: AssessmentPaper[],
  studentIds?: string[],
) {
  const classes = await db.classroom.findMany({
    where: { id: { in: classroomIds } },
    include: { students: true },
  });
  const students = classes.flatMap((classroom) =>
    classroom.students.map((student) => ({ student, classroom })),
  );
  if (
    studentIds &&
    (new Set(studentIds).size !== studentIds.length ||
      studentIds.some((id) => !students.some(({ student }) => student.id === id)))
  )
    throw new RequestError(400, "新增学生必须在本次安排的参与班级中，且不能重复。");
  const added = [];
  for (const { student, classroom } of students.filter(
    ({ student }) => !studentIds || studentIds.includes(student.id),
  )) {
    const participant = await db.assessmentParticipant.create({
      data: {
        assessmentId,
        studentId: student.id,
        classroomId: classroom.id,
        classroomName: classroom.name,
        name: student.name,
        studentNumber: student.studentNumber,
        stage: classroom.stage,
        cohort: classroom.cohort,
        subjects: {
          create: papers.map((paper) => ({
            paperId: paper.paperId,
            status: "REQUIRED",
            reason: "",
          })),
        },
      },
      include: { subjects: true },
    });
    added.push(participant);
  }
  return added;
}

export async function reconcileRosterConfiguration(
  db: Prisma.TransactionClient,
  assessmentId: string,
  classroomIds: string[],
  papers: AssessmentPaper[],
  studentIds: string[],
  reason: string,
) {
  const participants = await db.assessmentParticipant.findMany({
    where: { assessmentId },
    include: { subjects: true },
  });
  const selected = new Set(studentIds);
  const allowed = await db.classroomStudent.findMany({
    where: { id: { in: studentIds }, classroomId: { in: classroomIds } },
  });
  if (allowed.length !== selected.size || selected.size !== studentIds.length)
    throw new RequestError(400, "参试名单必须来自本次参与班级，且不能重复。");
  for (const participant of participants) {
    for (const subject of participant.subjects) {
      if (
        subject.status !== "WITHDRAWN" &&
        (!selected.has(participant.studentId) ||
          !papers.some((paper) => paper.paperId === subject.paperId))
      )
        await db.assessmentParticipantSubject.update({
          where: { id: subject.id },
          data: { status: "WITHDRAWN", reason },
        });
    }
    if (selected.has(participant.studentId)) {
      for (const paper of papers) {
        const existing = participant.subjects.find((subject) => subject.paperId === paper.paperId);
        if (!existing)
          await db.assessmentParticipantSubject.create({
            data: { participantId: participant.id, paperId: paper.paperId, status: "REQUIRED" },
          });
      }
    }
  }
  await addRosterParticipants(
    db,
    assessmentId,
    classroomIds,
    papers,
    studentIds.filter((id) => !participants.some((participant) => participant.studentId === id)),
  );
  return {
    before: participants,
    selectedStudentIds: studentIds,
    classroomIds,
    paperIds: papers.map((paper) => paper.paperId),
  };
}

export async function recordRosterEvent(
  db: Prisma.TransactionClient,
  assessmentId: string,
  revision: number,
  actorId: string,
  reason: string,
  changes: unknown,
) {
  await db.assessmentRosterEvent.create({
    data: { assessmentId, revision, actorId, reason, changes: json(changes) },
  });
}
