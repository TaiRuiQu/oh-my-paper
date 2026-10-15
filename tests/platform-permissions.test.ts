import { describe, expect, it } from "vitest";
import {
  canReadSubject,
  canReviewSubject,
  teachingPermissionsCommandSchema,
  type TeachingAssignment,
} from "@/contracts/permissions";
import { applyOfficialResults } from "@/server/platform/analytics";
import { scopePageState } from "@/server/platform/page-state";
import type { Analytics, PlatformState, StudentResult } from "@/contracts/platform";

const classroom = { id: "class-a", stage: "高中", cohort: "2027届" };
const teacher = (teachingAssignments: TeachingAssignment[] = []): PlatformState["actor"] => ({
  id: "teacher",
  name: "教师",
  role: "TEACHER",
  teachingAssignments,
});
describe("teaching data authorization", () => {
  it("fails closed for an unassigned teacher or a student", () => {
    expect(canReadSubject(teacher(), classroom, "数学")).toBe(false);
    expect(
      canReadSubject(
        { ...teacher([{ role: "SCHOOL_ADMIN" }]), role: "STUDENT" },
        classroom,
        "数学",
      ),
    ).toBe(false);
    expect(canReadSubject({ id: "admin", name: "管理员", role: "ADMIN" }, classroom, "数学")).toBe(
      true,
    );
  });
  it("unions homeroom and subject assignments without broadening either class", () => {
    const actor = teacher([
      { role: "HOMEROOM", classroomId: "class-a" },
      { role: "SUBJECT_TEACHER", classroomId: "class-b", subject: "数学" },
    ]);
    expect(canReadSubject(actor, classroom, "化学")).toBe(true);
    expect(canReadSubject(actor, { id: "class-b", stage: "高中", cohort: "2027届" }, "数学")).toBe(
      true,
    );
    expect(canReadSubject(actor, { id: "class-b", stage: "高中", cohort: "2027届" }, "化学")).toBe(
      false,
    );
    expect(canReadSubject(actor, { id: "class-c", stage: "高中", cohort: "2027届" }, "数学")).toBe(
      false,
    );
  });
  it("limits directors by classroom cohort and permits school-wide teaching visibility", () => {
    expect(
      canReadSubject(
        teacher([{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "2027届" }]),
        classroom,
        "数学",
      ),
    ).toBe(true);
    expect(
      canReadSubject(
        teacher([{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "2028届" }]),
        classroom,
        "数学",
      ),
    ).toBe(false);
    expect(canReadSubject(teacher([{ role: "SCHOOL_ADMIN" }]), classroom, "数学")).toBe(true);
  });
  it("groups joint-exam markers by student cohort independently of curriculum grades", () => {
    const actor = teacher([
      { role: "SUBJECT_TEACHER", classroomId: "teaching-class", subject: "数学" },
    ]);
    const exam = { reviewScope: "GRADE", classroomIds: [classroom.id] } as const;
    const assessment = { ...exam, classroomIds: [...exam.classroomIds] };
    expect(
      canReviewSubject(actor, assessment, classroom, "数学", [
        { id: "teaching-class", stage: "高中", cohort: "2027届" },
      ]),
    ).toBe(true);
    expect(
      canReviewSubject(actor, assessment, classroom, "数学", [
        { id: "teaching-class", stage: "高中", cohort: "2028届" },
      ]),
    ).toBe(false);
    expect(
      canReviewSubject(actor, assessment, classroom, "化学", [
        { id: "teaching-class", stage: "高中", cohort: "2027届" },
      ]),
    ).toBe(false);
  });
  it("isolates directors and joint-exam markers in different school stages with the same year", () => {
    const director = teacher([{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "2027届" }]);
    const marker = teacher([{ role: "SUBJECT_TEACHER", classroomId: "marker", subject: "数学" }]);
    for (const stage of ["小学", "初中"]) {
      expect(canReadSubject(director, { ...classroom, stage }, "数学")).toBe(false);
      expect(
        canReviewSubject(
          marker,
          { reviewScope: "GRADE", classroomIds: [classroom.id] },
          classroom,
          "数学",
          [{ id: "marker", stage, cohort: "2027届" }],
        ),
      ).toBe(false);
    }
    const parse = (assignments: unknown) =>
      teachingPermissionsCommandSchema.safeParse({
        type: "user.permissions",
        id: "teacher",
        assignments,
      }).success;
    expect(
      parse([
        { role: "GRADE_DIRECTOR", stage: "高中", cohort: "2027届" },
        { role: "GRADE_DIRECTOR", stage: "初中", cohort: "2027届" },
        { role: "GRADE_DIRECTOR", stage: "小学", cohort: "2027届" },
      ]),
    ).toBe(true);
    expect(parse([{ role: "GRADE_DIRECTOR", cohort: "2027届" }])).toBe(false);
    expect(parse([{ role: "GRADE_DIRECTOR", stage: "大学", cohort: "2027届" }])).toBe(false);
  });
  it("rejects malformed and duplicate scopes, and accepts explicit revocation", () => {
    const parse = (assignments: unknown) =>
      teachingPermissionsCommandSchema.safeParse({
        type: "user.permissions",
        id: "teacher",
        assignments,
      }).success;
    expect(parse([{ role: "SCHOOL_ADMIN", classroomId: "class-a" }])).toBe(false);
    expect(parse([{ role: "SUBJECT_TEACHER", classroomId: "class-a" }])).toBe(false);
    expect(parse([{ role: "SUBJECT_TEACHER", classroomId: "class-a", subject: "任意学科" }])).toBe(
      false,
    );
    expect(
      parse([
        { role: "HOMEROOM", classroomId: "class-a" },
        { role: "HOMEROOM", classroomId: "class-a" },
      ]),
    ).toBe(false);
    expect(parse([])).toBe(true);
  });
});

it("withholds full totals and ranks after repeated report projection while preserving the official subject rank", () => {
  const math = {
    paperId: "math",
    subject: "数学",
    rawScore: 6,
    score: 85,
    maxScore: 10,
    rank: 2,
    grades: [],
  };
  const chemistry = { ...math, paperId: "chemistry", subject: "化学" };
  const official = {
    assessmentId: "exam",
    studentId: "student",
    studentName: "学生",
    studentNumber: "1",
    classroomId: "class-a",
    classroomName: "一班",
    total: 170,
    rank: 1,
    classRank: 1,
    subjects: [math, chemistry],
  } satisfies StudentResult;
  const analytics: Analytics = {
    results: [{ ...official, subjects: [{ ...math, score: 6, rank: 1 }] }],
    students: [],
    knowledge: [],
    classrooms: [],
  };
  applyOfficialResults(analytics, [official]);
  expect(analytics.results[0]).toMatchObject({
    total: null,
    rank: null,
    classRank: null,
    totalRestricted: true,
    subjects: [math],
  });
  const projected = structuredClone(analytics);
  applyOfficialResults(projected, analytics.results);
  expect(projected.results[0].totalRestricted).toBe(true);
  expect(projected.results[0].total).toBeNull();
  const page = scopePageState(
    {
      actor: teacher([{ role: "SUBJECT_TEACHER", classroomId: "class-a", subject: "数学" }]),
      questions: [],
      papers: [],
      classrooms: [
        {
          ...classroom,
          name: "一班",
          ownerId: "other",

          students: [
            {
              id: "student",
              classroomId: "class-a",
              userId: null,
              studentNumber: "1",
              name: "学生",
            },
          ],
        },
      ],
      assessments: [
        {
          id: "exam",
          name: "联考",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          ownerId: "other",
          classroomIds: ["class-a"],
          papers: [math, chemistry].map((p) => ({
            paperId: p.paperId,
            subject: p.subject,
            gradingMode: "SINGLE",
            arbitrationThreshold: 0,
            conversion: { enabled: false, bands: [] },
          })),
          published: true,
          createdAt: "",
        },
      ],
      submissions: [],
      reviews: [],
      templates: [],
      users: [],
      analytics,
    } satisfies PlatformState,
    "exams",
  );
  expect(page.analytics.results[0].subjects.map((s) => s.subject)).toEqual(["数学"]);
  expect(page.analytics.results[0].totalRestricted).toBe(true);
});
