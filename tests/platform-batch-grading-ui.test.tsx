// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BatchGradingForm } from "@/components/platform/batch-grading";
import { GradingResults } from "@/components/platform/batch-grading-results";
import type { PlatformState } from "@/contracts/platform";
import type { GradingResult } from "@/contracts/platform-ai";
import { uploadDocument } from "@/lib/document-upload";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/document-upload", () => ({ uploadDocument: vi.fn() }));
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
const page = {
  id: "page",
  url: "/api/platform/assets/page",
  name: "全班作业.pdf · 第1页",
  page: 1,
  size: 100,
};
const student = {
  id: "student",
  classroomId: "class",
  userId: null,
  name: "小明",
  studentNumber: "000001",
};
const state = {
  actor: { id: "admin", role: "ADMIN", name: "教师" },
  classrooms: [{ id: "class", name: "一班", stage: "高中", cohort: "2027届", students: [student] }],
  assessments: [
    {
      id: "assignment",
      kind: "HOMEWORK",
      name: "数学作业",
      classroomIds: ["class"],
      papers: [{ paperId: "paper", subject: "数学" }],
      published: false,
      rosterRevision: 1,
      rosterStatus: "CONFIRMED",
      participants: [
        {
          id: "participant",
          studentId: student.id,
          name: student.name,
          studentNumber: student.studentNumber,
          classroomId: "class",
          classroomName: "一班",
          stage: "高中",
          cohort: "2027届",
          subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
        },
      ],
    },
  ],
  papers: [{ id: "paper", name: "函数练习" }],
  submissions: [],
  reviews: [],
} as unknown as PlatformState;
let container: HTMLDivElement, root: Root;
const start = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(uploadDocument).mockResolvedValue({
    id: "doc",
    url: page.url,
    pageCount: 1,
    pages: [page],
  });
  start.mockResolvedValue({ id: "job" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function select(index: number, value: string) {
  await act(async () => {
    const control = container.querySelectorAll("select")[index];
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function upload() {
  await act(async () => {
    const control = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(control, "files", {
      configurable: true,
      value: [new File(["pdf"], "全班作业.pdf", { type: "application/pdf" })],
    });
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("assigns uploaded page groups to explicit students before submitting", async () => {
  await act(async () => root.render(<BatchGradingForm state={state} busy={false} start={start} />));
  await select(0, "assignment");
  await select(1, "class");
  await upload();
  expect(container.querySelectorAll("select")).toHaveLength(4);
  await select(3, student.id);
  expect(uploadDocument).toHaveBeenCalledWith(expect.any(File), 100);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(start).toHaveBeenCalledWith("GRADE", {
    assessmentId: "assignment",
    rosterRevision: 1,
    classroomId: "class",
    paperId: "paper",
    assetUrls: [page.url],
    pagesPerStudent: 1,
    studentIds: [student.id],
  });
});
it("requires the matching answer-card template for uploaded exam pages", async () => {
  const exam = {
    ...state,
    assessments: [{ ...state.assessments[0], kind: "EXAM" as const }],
    templates: ["card-a", "card-b"].map((id) => ({
      id,
      paperId: "paper",
      name: id,
      preset: false,
      layout: { pageCount: 1 },
    })),
  } as PlatformState;
  await act(async () => root.render(<BatchGradingForm state={exam} busy={false} start={start} />));
  await select(0, "assignment");
  await select(1, "class");
  await upload();
  const submit = async () =>
    act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  await submit();
  expect(start).not.toHaveBeenCalled();
  await select(3, "card-b");
  await select(4, student.id);
  await submit();
  expect(start).toHaveBeenCalledWith(
    "GRADE",
    expect.objectContaining({ templateId: "card-b", assetUrls: [page.url] }),
  );
});
it("can bulk grade existing unreviewed class work without uploading again", async () => {
  const existing = {
    ...state,
    submissions: [
      {
        id: "sub",
        assessmentId: "assignment",
        paperId: "paper",
        studentId: student.id,
      } as PlatformState["submissions"][number],
    ],
  };
  await act(async () =>
    root.render(<BatchGradingForm state={existing} busy={false} start={start} />),
  );
  await select(0, "assignment");
  await select(1, "class");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(start).toHaveBeenCalledWith("GRADE", expect.objectContaining({ assetUrls: [] }));
});

it("offers only required participant snapshots and never the changed live classroom roster", async () => {
  const rosterState = {
    ...state,
    classrooms: [
      {
        ...state.classrooms[0],
        students: [{ ...student, id: "new-student", name: "后来加入", studentNumber: "999999" }],
      },
    ],
    assessments: [
      {
        ...state.assessments[0],
        participants: [
          state.assessments[0].participants[0],
          ...(["ABSENT", "EXEMPT", "WITHDRAWN"] as const).map((status) => ({
            ...state.assessments[0].participants[0],
            id: status,
            studentId: status,
            name: status,
            subjects: [{ paperId: "paper", status, reason: "登记" }],
          })),
        ],
      },
    ],
  };
  await act(async () =>
    root.render(<BatchGradingForm state={rosterState} busy={false} start={start} />),
  );
  await select(0, "assignment");
  await select(1, "class");
  await upload();
  const options = [...container.querySelectorAll<HTMLSelectElement>("select")][3].options;
  expect([...options].map((option) => option.value)).toEqual(["", "student"]);
  expect([...options].map((option) => option.textContent).join(" ")).toContain("000001 · 小明");
  expect(container.textContent).not.toContain("后来加入");
});

it("blocks unconfirmed rosters before file conversion and task submission", async () => {
  const unconfirmed = {
    ...state,
    assessments: [{ ...state.assessments[0], rosterStatus: "NEEDS_REVIEW" as const }],
  };
  await act(async () =>
    root.render(<BatchGradingForm state={unconfirmed} busy={false} start={start} />),
  );
  await select(0, "assignment");
  await select(1, "class");
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
  await upload();
  expect(uploadDocument).not.toHaveBeenCalled();
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(start).not.toHaveBeenCalled();
  expect(container.textContent).toContain("核对并确认学生");
});

it("does not offer AI grading over another teacher's hidden occupied round", async () => {
  const existing = {
    ...state,
    submissions: [
      {
        id: "sub",
        assessmentId: "assignment",
        paperId: "paper",
        studentId: student.id,
      } as PlatformState["submissions"][number],
    ],
    reviewAssignments: [
      {
        submissionId: "sub",
        itemId: "item",
        blind: true,
        rounds: [{ round: "FIRST" as const, reviewerId: "other" }],
        availableRounds: [],
      },
    ],
  };
  await act(async () =>
    root.render(<BatchGradingForm state={existing} busy={false} start={start} />),
  );
  await select(0, "assignment");
  await select(1, "class");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(start).not.toHaveBeenCalled();
  expect(container.textContent).toContain("未评分作答 0 份");
});
it("keeps successfully uploaded pages and reports a later file upload failure", async () => {
  await act(async () => root.render(<BatchGradingForm state={state} busy={false} start={start} />));
  await upload();
  vi.mocked(uploadDocument).mockRejectedValueOnce(new Error("PDF 无法读取，请重新上传"));
  await upload();
  expect(container.textContent).toContain("已上传 1 页");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("PDF 无法读取");
});
it("shows scan failures with original images without the removed identity retry flow", async () => {
  const result: GradingResult = {
    assessmentId: "assignment",
    assessmentKind: "EXAM",
    classroomId: "class",
    paperId: "paper",
    students: [],
    pendingPages: [{ sourceUrl: page.url, reason: "定位点不清晰" }],
  };
  await act(async () => root.render(<GradingResults result={result} />));
  expect(container.textContent).toContain("定位点不清晰");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(page.url);
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
});
