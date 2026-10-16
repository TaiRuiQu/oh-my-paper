import type { PaperItem, AssessmentPaper, AssessmentParticipant } from "@/contracts/platform";

/** Owned JSON collections are validated by domain commands before persistence. */
export function paperRecord<T extends { items: unknown; readingAssetUrls?: string[] }>(row: T) {
  const { items, readingAssetUrls, ...rest } = row;
  void readingAssetUrls;
  return { ...rest, items: items as PaperItem[] };
}

export function assessmentRecord<
  T extends {
    papers: unknown;
    rosterStatus: string;
    kind: string;
    reviewScope: string;
    createdAt: Date | string;
    participants: Parameters<typeof participantRecord>[0][];
  },
>(row: T) {
  const { papers, ...rest } = row;
  return {
    ...rest,
    papers: papers as AssessmentPaper[],
    rosterStatus: row.rosterStatus as "CONFIRMED" | "NEEDS_REVIEW",
    kind: row.kind as "EXAM" | "HOMEWORK",
    reviewScope: row.reviewScope as "CLASSROOM" | "GRADE",
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    participants: row.participants
      .map(participantRecord)
      .sort(
        (left, right) =>
          left.classroomName.localeCompare(right.classroomName, "zh-CN", { numeric: true }) ||
          left.studentNumber.localeCompare(right.studentNumber, "zh-CN", { numeric: true }) ||
          left.id.localeCompare(right.id),
      ),
  };
}

export function participantRecord(
  row: Omit<AssessmentParticipant, "subjects"> & {
    subjects: { paperId: string; status: string; reason: string }[];
  },
): AssessmentParticipant {
  return {
    id: row.id,
    studentId: row.studentId,
    classroomId: row.classroomId,
    classroomName: row.classroomName,
    name: row.name,
    studentNumber: row.studentNumber,
    stage: row.stage,
    cohort: row.cohort,
    subjects: row.subjects.map((subject) => ({
      paperId: subject.paperId,
      status: subject.status as AssessmentParticipant["subjects"][number]["status"],
      reason: subject.reason,
    })),
  };
}
