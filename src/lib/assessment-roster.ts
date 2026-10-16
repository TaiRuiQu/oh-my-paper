import type { Assessment, StudentResult } from "@/contracts/platform";

export function assessmentPublicationLabel(
  assessment: Pick<Assessment, "rosterStatus" | "published">,
) {
  if (assessment.rosterStatus !== "CONFIRMED") return "名单待确认 · 学生暂不可见";
  return assessment.published ? "成绩已发布" : "进行中";
}

export function findAssessmentParticipant(assessment: Assessment, studentId: string) {
  return assessment.participants.find((participant) => participant.studentId === studentId);
}

export function participantSubject(assessment: Assessment, studentId: string, paperId: string) {
  return findAssessmentParticipant(assessment, studentId)?.subjects.find(
    (subject) => subject.paperId === paperId,
  );
}

export function assessmentReviewBlockReason(
  assessment: Assessment,
  studentId: string,
  paperId: string,
): string | null {
  if (assessment.rosterStatus !== "CONFIRMED") return "本次参试名单尚未确认，暂不能评阅";
  const subject = participantSubject(assessment, studentId, paperId);
  if (!subject) return "该学生不在本次科目参与名单中，原答卷仅供查看";
  if (subject.status === "REQUIRED") return null;
  const status = { ABSENT: "缺考", EXEMPT: "免考", WITHDRAWN: "退出" }[subject.status];
  return `本次科目已登记${status}，原答卷与评分保留，暂不能评阅`;
}

export function assessmentRosterStudents(assessment: Assessment, classroomId?: string) {
  return assessment.participants
    .filter((participant) => !classroomId || participant.classroomId === classroomId)
    .map((participant) => ({
      ...participant,
      id: participant.studentId,
      participantId: participant.id,
    }));
}

export function rosterStudentsForPaper(
  assessment: Assessment,
  paperId: string,
  classroomId?: string,
) {
  return assessmentRosterStudents(assessment, classroomId).filter((participant) =>
    participant.subjects.some(
      (subject) => subject.paperId === paperId && subject.status === "REQUIRED",
    ),
  );
}

export function rosterPublicationReadiness(assessment: Assessment, results: StudentResult[]) {
  const participants = assessment.participants.filter((participant) =>
    participant.subjects.some((subject) => subject.status !== "WITHDRAWN"),
  );
  const unfinished = participants.filter((participant) =>
    assessment.papers.some((paper) => {
      const subject = participant.subjects.find((entry) => entry.paperId === paper.paperId);
      if (!subject) return true;
      if (subject.status !== "REQUIRED") return false;
      const result = results.find(
        (row) => row.assessmentId === assessment.id && row.studentId === participant.studentId,
      );
      return !result?.subjects.some(
        (entry) => entry.paperId === paper.paperId && entry.score !== null,
      );
    }),
  );
  return {
    ready:
      assessment.rosterStatus === "CONFIRMED" && participants.length > 0 && unfinished.length === 0,
    expected: participants.length,
    unfinished,
  };
}
