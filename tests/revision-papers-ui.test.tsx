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
