// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BatchGradingForm } from "@/components/platform/batch-grading";
import { BatchGradingResults } from "@/components/platform/batch-grading-results";
import type { PlatformState } from "@/contracts/platform";
import type { AiJobDTO, BatchGradingResult } from "@/contracts/platform-ai";
import { uploadDocument } from "@/lib/document-upload";
import { apiRequest } from "@/lib/http-client";
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
  classrooms: [{ id: "class", name: "一班", grade: "高一", students: [student] }],
  assessments: [
    {
      id: "assignment",
      kind: "HOMEWORK",
      name: "数学作业",
      classroomIds: ["class"],
      papers: [{ paperId: "paper", subject: "数学" }],
      published: false,
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
it("uploads class materials and submits one task without student selection or answer boxes", async () => {
  await act(async () => root.render(<BatchGradingForm state={state} busy={false} start={start} />));
  await select(0, "assignment");
  await select(1, "class");
  await upload();
  expect(container.querySelectorAll("select")).toHaveLength(3);
  expect(uploadDocument).toHaveBeenCalledWith(expect.any(File), 100);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(start).toHaveBeenCalledWith("BATCH_GRADE", {
    assessmentId: "assignment",
    classroomId: "class",
    paperId: "paper",
    assetUrls: [page.url],
  });
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
  expect(start).toHaveBeenCalledWith("BATCH_GRADE", expect.objectContaining({ assetUrls: [] }));
});
it("keeps successfully uploaded pages and reports a later file upload failure", async () => {
  await act(async () => root.render(<BatchGradingForm state={state} busy={false} start={start} />));
  await upload();
  vi.mocked(uploadDocument).mockRejectedValueOnce(new Error("PDF 无法读取，请重新上传"));
  await upload();
  expect(container.textContent).toContain("已上传 1 页");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("PDF 无法读取");
});
it("confirms an unidentified page and resubmits only selected pending material", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ id: "recovered" });
  const result: BatchGradingResult = {
    assessmentId: "assignment",
    assessmentKind: "HOMEWORK",
    classroomId: "class",
    paperId: "paper",
    students: [],
    pendingPages: [{ sourceUrl: page.url, reason: "未写姓名" }],
  };
  await act(async () =>
    root.render(
      <BatchGradingResults
        state={state}
        job={{ id: "job", modelId: "model" } as AiJobDTO}
        result={result}
      />,
    ),
  );
  await select(0, student.id);
  await act(async () => container.querySelector("button")!.click());
  const body = JSON.parse(String(vi.mocked(apiRequest).mock.calls[0][1]?.body));
  expect(body).toEqual({
    kind: "BATCH_GRADE",
    modelId: "model",
    input: {
      assessmentId: "assignment",
      classroomId: "class",
      paperId: "paper",
      assetUrls: [page.url],
      studentHints: [{ sourceUrl: page.url, studentId: student.id }],
    },
  });
  expect(push).toHaveBeenCalledWith("/workspace/ai/recovered");
});
