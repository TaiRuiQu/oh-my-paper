// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cohortKey } from "@/lib/student-cohort";
import { AssessmentEditor } from "@/components/platform/assessments";
import type { PlatformState } from "@/contracts/platform";

let container: HTMLDivElement, root: Root;
const state: PlatformState = {
  actor: { id: "admin", name: "管理员", role: "ADMIN" },
  questions: [],
  papers: [
    {
      id: "math",
      ownerId: "admin",
      name: "数学试卷",
      subject: "数学",
      grade: "高一",
      kind: "EXAM",
      instructions: "",
      layout: { paperSize: "A4", columns: 1 },
      createdAt: "",
      updatedAt: "",
      items: [],
    },
  ],
  classrooms: [
    { id: "a", name: "一班", stage: "高中", cohort: "2027届", ownerId: "admin", students: [] },
    { id: "b", name: "二班", stage: "高中", cohort: "2027届", ownerId: "admin", students: [] },
    { id: "c", name: "一班", stage: "高中", cohort: "2028届", ownerId: "admin", students: [] },
    { id: "junior", name: "一班", stage: "初中", cohort: "2027届", ownerId: "admin", students: [] },
    {
      id: "primary",
      name: "一班",
      stage: "小学",
      cohort: "2027届",
      ownerId: "admin",
      students: [],
    },
  ],
  assessments: [],
  submissions: [],
  reviews: [],
  templates: [],
  users: [],
  analytics: { results: [], students: [], knowledge: [], classrooms: [] },
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function select(label: string) {
  return [...container.querySelectorAll("label")]
    .find((node) => node.querySelector("span")?.textContent === label)!
    .querySelector("select")!;
}
async function change(label: string, value: string) {
  await act(async () => {
    const element = select(label);
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("selects one cohort's classes for a joint exam and persists the chosen marking scope", async () => {
  const mutate = vi.fn().mockResolvedValue({ id: "exam" });
  await act(async () =>
    root.render(
      createElement(AssessmentEditor, {
        assessment: null,
        state,
        mutate,
        pending: false,
        close: vi.fn(),
        fixedKind: "EXAM",
        initialPaperId: "math",
      }),
    ),
  );
  await change("阅卷范围", "GRADE");
  expect(
    [...container.querySelectorAll<HTMLInputElement>('input[name="classroomIds"]')].map((c) => [
      c.value,
      c.checked,
    ]),
  ).toEqual([
    ["a", true],
    ["b", true],
  ]);
  expect(container.textContent).toContain("同学段、同届别任课老师按任教学科统一阅卷");
  expect(container.textContent).toContain("无需单独指定教师");
  await change("联考届别", cohortKey({ stage: "高中", cohort: "2028届" }));
  expect(container.querySelector<HTMLInputElement>('input[name="classroomIds"]')?.value).toBe("c");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      assessment: expect.objectContaining({
        reviewScope: "GRADE",
        classroomIds: ["c"],
        papers: [expect.objectContaining({ paperId: "math" })],
      }),
    }),
  );
});
it("keeps homework in classroom scope without a joint-exam option", async () => {
  await act(async () =>
    root.render(
      createElement(AssessmentEditor, {
        assessment: null,
        state,
        mutate: vi.fn(),
        pending: false,
        close: vi.fn(),
        fixedKind: "HOMEWORK",
      }),
    ),
  );
  expect([...select("阅卷范围").options].map((o) => o.value)).toEqual(["CLASSROOM"]);
  expect(container.textContent).toContain("各班任课老师仅评阅本班对应学科");
  expect(container.querySelector('input[name="reviewerIds"]')).toBeNull();
});
