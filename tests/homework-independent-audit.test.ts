import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { HomeworkFrozenPaper } from "@/contracts/homework";
import type { PlatformState } from "@/contracts/platform";
import type { Db } from "@/server/platform/access";
import {
  canManageHomework,
  attemptSummary,
  promptText,
  studentPaper,
  visibleWorks,
  workDTO,
  type AssignmentRow,
} from "@/server/platform/homework/context";
import { canReadHomeworkAsset } from "@/server/platform/homework/assets";

const prompt = "/api/platform/assets/11111111-1111-4111-8111-111111111111";
const solution = "/api/platform/assets/22222222-2222-4222-8222-222222222222";
const proof = "/api/platform/assets/33333333-3333-4333-8333-333333333333";
const now = new Date("2026-11-15T00:00:00Z");
const student: PlatformState["actor"] = { id: "S", name: "本人", role: "STUDENT" };
const director = (cohort: string): PlatformState["actor"] => ({
  id: "owner",
  name: "年级主任",
  role: "TEACHER",
  teachingAssignments: [{ role: "GRADE_DIRECTOR", stage: "高中", cohort }],
});
function frozen(): HomeworkFrozenPaper {
  return {
    studentImageUrls: [],
    studentImageUrlsByItem: { item: [prompt] },
    paper: {
      id: "paper",
      ownerId: "owner",
      name: "数学作业",
      kind: "HOMEWORK",
      subject: "数学",
      grade: "高中一年级",
      instructions: "独立完成",
      layout: { paperSize: "A4", columns: 1 },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      items: [
        {
          id: "item",
          questionId: "q",
          position: 1,
          score: 10,
          section: "",
          snapshot: {
            id: "q",
            ownerId: "owner",
            type: "SUBJECTIVE",
            subject: "数学",
            grade: "高中一年级",
            difficulty: 0.5,
            knowledgeTags: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            content: {
              stem: `$a<b$，$c>d$ ![题面](${prompt})`,
              options: [],
              parts: [],
              images: [prompt, solution],
              answers: ["ANSWER_SECRET"],
              explanation: `![解析](${solution})`,
              rubric: "RUBRIC_SECRET",
            },
          },
        },
      ],
    },
  };
}
function assignment(): AssignmentRow {
  const subject = {
    id: "subject",
    participantId: "participant",
    paperId: "paper",
    status: "REQUIRED",
    reason: "",
  };
  const participant = {
    id: "participant",
    assessmentId: "assessment",
    studentId: "student",
    classroomId: "class",
    classroomName: "历史一班",
    name: "历史姓名",
    studentNumber: "001",
    stage: "高中",
    cohort: "2027届",
    subjects: [subject],
    student: { userId: "S" },
    classroom: { id: "class", stage: "高中", cohort: "2028届" },
  };
  return {
    id: "assignment",
    assessmentId: "assessment",
    version: 1,
    status: "ISSUED",
    name: "作业",
    instructions: "说明",
    timezone: "Asia/Shanghai",
    dueLocal: "2026-11-16T08:00",
    dueAt: new Date("2026-11-16T00:00:00Z"),
    allowLate: false,
    rosterRevision: 1,
    papers: z.json().parse([frozen()]),
    promptAssetUrls: [prompt],
    issuedBy: "owner",
    issuedAt: now,
    updatedAt: now,
    assessment: {
      id: "assessment",
      ownerId: "owner",
      name: "作业",
      kind: "HOMEWORK",
      reviewScope: "CLASSROOM",
      classroomIds: ["class"],
      papers: [{ paperId: "paper", subject: "数学" }],
      published: false,
      rosterRevision: 1,
      rosterStatus: "CONFIRMED",
      createdAt: now,
      participants: [participant],
    },
    works: [
      {
        id: "work",
        assignmentId: "assignment",
        participantSubjectId: "subject",
        version: 1,
        draftVersion: 1,
        draftUpdatedAt: now,
        draftAnswers: [{ itemId: "item", text: "PRIVATE_DRAFT", images: [proof] }],
        collectionStatus: "NOT_SUBMITTED",
        dueAtOverride: null,
        dueLocalOverride: null,
        extensionReason: "",
        currentAttemptId: null,
        updatedAt: now,
        participantSubject: { ...subject, participant },
        attempts: [],
      },
    ],
  };
}
let row: AssignmentRow;
function dbFor(current: AssignmentRow, submittedProof = false) {
  return {
    homeworkAssignment: {
      findMany: vi.fn(async () => [current]),
      findUnique: vi.fn(async () => current),
    },
    homeworkAsset: {
      findUnique: vi.fn(async ({ where }: { where: { assetId: string } }) =>
        where.assetId === proof.split("/").at(-1)
          ? { workId: "work", work: { assignmentId: current.id } }
          : null,
      ),
    },
    homeworkAttempt: { findFirst: vi.fn(async () => (submittedProof ? { id: "receipt" } : null)) },
  } as unknown as Db;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  row = assignment();
});
afterEach(() => vi.useRealTimers());

it("checks a grade director against the current classroom cohort while retaining historical display identity", () => {
  expect(visibleWorks(director("2027届"), row)).toEqual([]);
  expect(canManageHomework(director("2027届"), row)).toBe(false);
  expect(visibleWorks(director("2028届"), row)).toHaveLength(1);
  expect(canManageHomework(director("2028届"), row)).toBe(true);
  expect(workDTO(director("2028届"), row, row.works[0]).classroomName).toBe("历史一班");
});
it("keeps the bound student's draft savable while the roster awaits explicit sync", () => {
  row.assessment.rosterRevision++;
  const dto = workDTO(student, row, row.works[0]);
  expect(dto.capabilities.canSaveDraft).toBe(true);
  expect(dto.capabilities.canSubmit).toBe(false);
  expect(dto.capabilities.canUpload).toBe(false);
});
it("revokes homework reads immediately when the current student account is no longer bound", async () => {
  row.works[0].participantSubject.participant.student.userId = "replacement";
  expect(visibleWorks(student, row)).toEqual([]);
  await expect(canReadHomeworkAsset(student, prompt, dbFor(row))).resolves.toBe(false);
});
it.each(["CANCELLED", "WITHDRAWN"])(
  "does not authorize new prompt media for a %s student's retained record",
  async (condition) => {
    if (condition === "CANCELLED") row.status = condition;
    else row.works[0].participantSubject.status = condition;
    await expect(canReadHomeworkAsset(student, prompt, dbFor(row))).resolves.toBe(false);
  },
);
it("does not grant a teacher access to an unsubmitted student's draft image", async () => {
  await expect(canReadHomeworkAsset(director("2028届"), proof, dbFor(row))).resolves.toBe(false);
});
it("does not disclose hidden answer fields or solution-only pictures in the issued prompt", () => {
  const value = JSON.stringify(studentPaper(frozen()));
  expect(value).not.toContain("ANSWER_SECRET");
  expect(value).not.toContain("RUBRIC_SECRET");
  expect(value).not.toContain(solution);
  expect(value).toContain(prompt);
});
it("preserves comparison operators across mathematical expressions instead of deleting them as HTML", () => {
  const text = "$a<b$，$c>d$；当 $x<3$ 且 $y>2$。";
  expect(promptText(text, [])).toBe(text);
});
it("includes shared reading material and its selected images without exposing layout-only metadata", () => {
  const source = frozen();
  source.studentImageUrls = [proof];
  source.paper.instructions = `阅读材料后完成作答 ![说明配图](${proof})`;
  source.paper.layout.textBlocks = [
    {
      id: "reading",
      text: `阅读 $a<b$，$c>d$ ![阅读图](${proof})`,
      beforeQuestionId: "item",
      pageBreakBefore: true,
    },
  ];
  const dto = studentPaper(source);
  expect(dto.instructions).toContain(proof);
  expect(dto.textBlocks).toEqual([
    { id: "reading", text: source.paper.layout.textBlocks[0].text, beforeQuestionId: "item" },
  ]);
  expect(dto.studentImageUrls).toEqual([proof]);
  expect(JSON.stringify(dto)).not.toContain("pageBreakBefore");
});
it("does not shorten an individually extended deadline when the entire class gets a later deadline", () => {
  row.dueAt = new Date("2026-11-18T00:00:00Z");
  row.dueLocal = "2026-11-18T08:00";
  row.works[0].dueAtOverride = new Date("2026-11-17T00:00:00Z");
  row.works[0].dueLocalOverride = "2026-11-17T08:00";
  row.works[0].extensionReason = "原个人延期";
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
  const dto = workDTO(student, row, row.works[0]);
  expect(dto.dueAt).toBe(row.dueAt.toISOString());
  expect(dto.dueLocal).toBe(row.dueLocal);
  expect(dto.capabilities.canSubmit).toBe(true);
});
it("does not relabel a genuinely submitted attempt as returned when its assignment is cancelled", () => {
  row.status = "CANCELLED";
  const work = row.works[0];
  const attempt: (typeof work.attempts)[number] = {
    id: "receipt",
    workId: work.id,
    sequence: 1,
    requestId: "request",
    submissionId: "submission",
    submittedBy: "S",
    submittedAt: now,
    late: false,
    submission: { active: false },
  };
  expect(attemptSummary(work, attempt).status).toBe("SUBMITTED");
  expect(attemptSummary(work, attempt).returnReason).toBe("");
});
it("retains access to one's immutable submitted evidence after cancellation without reopening prompt access", async () => {
  row.status = "CANCELLED";
  await expect(canReadHomeworkAsset(student, proof, dbFor(row, true))).resolves.toBe(true);
  await expect(canReadHomeworkAsset(student, prompt, dbFor(row, true))).resolves.toBe(false);
});
