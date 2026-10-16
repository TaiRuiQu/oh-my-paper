// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { RevisionPaperBuilder } from "@/components/platform/revision-paper-pages";
const mocks = vi.hoisted(() => ({
  state: {} as PlatformState,
  push: vi.fn(),
  request: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: mocks.state, refresh: mocks.refresh, notify: vi.fn() }),
}));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
vi.mock("@/lib/http-client", () => ({
  apiRequest: mocks.request,
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));

it("clears an old assessment when switching students and submits only the new student's wrong questions", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.state = {
    actor: { id: "teacher", name: "教师", role: "TEACHER" },
    papers: [],
    classrooms: [
      {
        id: "class",
        students: [
          { id: "one", name: "学生甲" },
          { id: "two", name: "学生乙" },
        ],
      },
    ],
    assessments: [
      { id: "a1", kind: "HOMEWORK", name: "甲的作业" },
      { id: "a2", kind: "HOMEWORK", name: "乙的作业" },
    ],
    analytics: {
      students: ["one", "two"].map((studentId, i) => ({
        studentId,
        wrongQuestions: [
          {
            assessmentId: `a${i + 1}`,
            itemId: `i${i + 1}`,
            maximum: 5,
            score: 1,
            question: {
              id: `q${i + 1}`,
              subject: "数学",
              type: "BLANK",
              content: { stem: "原题", parts: [] },
            },
          },
        ],
      })),
    },
  } as unknown as PlatformState;
  mocks.request.mockResolvedValue({ id: "revision", count: 1 });
  mocks.refresh.mockResolvedValue(undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<RevisionPaperBuilder initialStudentId="one" initialAssessmentId="a1" />),
    );
    const assessment = host.querySelector<HTMLSelectElement>('[aria-label="筛选教学安排"]')!;
    expect(assessment.value).toBe("a1");
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>('[aria-label="选择学生"]')!;
      select.value = "two";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(assessment.value).toBe("");
    expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({
      studentId: "two",
      sources: [{ assessmentId: "a2", itemId: "i2" }],
    });
    expect(mocks.push).toHaveBeenCalledWith("/workspace/revision-papers/revision");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function withReplay(run: (host: HTMLDivElement) => Promise<void>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.request.mockReset();
  mocks.refresh.mockReset();
  mocks.state = {
    actor: { id: "student-user", role: "STUDENT", name: "学生" },
    papers: [],
    classrooms: [{ id: "class", students: [{ id: "student", name: "学生" }] }],
    assessments: [{ id: "assessment", kind: "HOMEWORK", name: "阅读作业" }],
    analytics: {
      students: [
        {
          studentId: "student",
          wrongQuestions: [
            {
              assessmentId: "assessment",
              itemId: "item",
              maximum: 5,
              score: 1,
              question: {
                id: "question",
                subject: "语文",
                type: "BLANK",
                content: { stem: "原题", parts: [] },
              },
            },
          ],
        },
      ],
    },
  } as unknown as PlatformState;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<RevisionPaperBuilder />));
    await run(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}
async function submitReplay(host: HTMLDivElement) {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function retryRead(host: HTMLDivElement) {
  const button = [...host.querySelectorAll("button")].find(
    (entry) => entry.textContent === "重新读取并打开题本",
  )!;
  await act(async () => button.click());
}
it("retains the created paper on refresh failure and rereads it without another POST", async () => {
  await withReplay(async (host) => {
    mocks.request.mockResolvedValue({ id: "saved-paper", count: 1 });
    mocks.refresh.mockRejectedValue(new Error("读取失败"));
    await submitReplay(host);
    expect(host.textContent).toContain("题本已生成，但最新资料读取失败");
    expect(host.textContent).not.toContain("生成失败，请重试");
    expect(
      host.querySelector('a[href="/workspace/revision-papers/saved-paper"]')?.textContent,
    ).toBe("打开已生成题本");
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await submitReplay(host);
    await retryRead(host);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("重新读取仍失败");
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.refresh.mockResolvedValue(undefined);
    await retryRead(host);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/workspace/revision-papers/saved-paper");
  });
});
it("serializes creation while refresh is pending and keeps its saved result", async () => {
  await withReplay(async (host) => {
    let reject!: (error: Error) => void;
    mocks.request.mockResolvedValue({ id: "pending-paper", count: 1 });
    mocks.refresh.mockImplementation(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    await submitReplay(host);
    await submitReplay(host);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(host.querySelector('a[href="/workspace/revision-papers/pending-paper"]')).not.toBeNull();
    await act(async () => reject(new Error("刷新失败")));
    expect(host.textContent).toContain("题本已生成，但最新资料读取失败");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
it("allows retry after the creation POST itself fails without inventing a saved result", async () => {
  await withReplay(async (host) => {
    mocks.request
      .mockRejectedValueOnce(new Error("尚未创建，网络失败"))
      .mockResolvedValueOnce({ id: "retry-created", count: 1 });
    mocks.refresh.mockResolvedValue(undefined);
    await submitReplay(host);
    expect(host.textContent).toContain("尚未创建，网络失败");
    expect(host.textContent).not.toContain("打开已生成题本");
    expect(host.querySelector("fieldset")?.disabled).toBe(false);
    await submitReplay(host);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith("/workspace/revision-papers/retry-created");
  });
});
