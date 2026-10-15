// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeachingPermissions } from "@/components/platform/teaching-permissions";
import type { Classroom } from "@/contracts/platform";

let container: HTMLDivElement, root: Root;
const classrooms: Classroom[] = [
  { id: "a", name: "一班", grade: "高一", ownerId: "admin", students: [] },
  { id: "b", name: "二班", grade: "高二", ownerId: "admin", students: [] },
];
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
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => button.click());
}
it("edits overlapping homeroom and subject identities and submits the complete selection", async () => {
  const save = vi.fn();
  await act(async () =>
    root.render(
      createElement(TeachingPermissions, {
        name: "张老师",
        assignments: [{ role: "HOMEROOM", classroomId: "a" }],
        classrooms,
        busy: false,
        onSave: save,
        onCancel: vi.fn(),
      }),
    ),
  );
  expect(document.activeElement).toBe(container.querySelector("select"));
  await click("添加教学身份");
  const selects = container.querySelectorAll("select");
  await act(async () => {
    selects[3].value = "b";
    selects[3].dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    selects[4].value = "数学";
    selects[4].dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("保存教学权限");
  expect(save).toHaveBeenCalledWith([
    { role: "HOMEROOM", classroomId: "a" },
    { role: "SUBJECT_TEACHER", classroomId: "b", subject: "数学" },
  ]);
  expect(container.textContent).toContain("不展示全科总分和总排名");
});
it("makes removing all identities an explicit empty permission save", async () => {
  const save = vi.fn();
  await act(async () =>
    root.render(
      createElement(TeachingPermissions, {
        name: "张老师",
        assignments: [{ role: "SCHOOL_ADMIN" }],
        classrooms,
        busy: false,
        onSave: save,
        onCancel: vi.fn(),
      }),
    ),
  );
  await click("移除");
  expect(container.textContent).toContain("无法查看任何班级");
  await click("保存教学权限");
  expect(save).toHaveBeenCalledWith([]);
});

it("keeps duplicate identities editable and prevents saving until the duplicate is removed", async () => {
  const save = vi.fn();
  await act(async () =>
    root.render(
      createElement(TeachingPermissions, {
        name: "张老师",
        assignments: [{ role: "SUBJECT_TEACHER", classroomId: "a", subject: "语文" }],
        classrooms,
        busy: false,
        onSave: save,
        onCancel: vi.fn(),
      }),
    ),
  );
  await click("添加教学身份");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("教学身份重复");
  await click("保存教学权限");
  expect(save).not.toHaveBeenCalled();
  await click("移除");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await click("保存教学权限");
  expect(save).toHaveBeenCalledWith([
    { role: "SUBJECT_TEACHER", classroomId: "a", subject: "语文" },
  ]);
});
