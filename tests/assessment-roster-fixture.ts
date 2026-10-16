import type { Assessment, Classroom, PlatformState } from "@/contracts/platform";

/** Explicit setup of a confirmed assessment-time snapshot for legacy test scenarios. */
export function confirmedRoster(
  assessment: Pick<Assessment, "id" | "classroomIds" | "papers">,
  classrooms: Classroom[],
): Pick<Assessment, "rosterRevision" | "rosterStatus" | "participants"> {
  return {
    rosterRevision: 1,
    rosterStatus: "CONFIRMED",
    participants: classrooms
      .filter((classroom) => assessment.classroomIds.includes(classroom.id))
      .flatMap((classroom) =>
        classroom.students.map((student) => ({
          id: `${assessment.id}/${student.id}`,
          studentId: student.id,
          classroomId: classroom.id,
          classroomName: classroom.name,
          name: student.name,
          studentNumber: student.studentNumber,
          stage: classroom.stage,
          cohort: classroom.cohort,
          subjects: assessment.papers.map((paper) => ({
            paperId: paper.paperId,
            status: "REQUIRED" as const,
            reason: "",
          })),
        })),
      ),
  };
}

export function withConfirmedRosters(
  state: Omit<PlatformState, "assessments"> & {
    assessments: Omit<Assessment, "rosterRevision" | "rosterStatus" | "participants">[];
  },
): PlatformState {
  return {
    ...state,
    assessments: state.assessments.map((assessment) => ({
      ...assessment,
      ...confirmedRoster(assessment, state.classrooms),
    })),
  };
}
