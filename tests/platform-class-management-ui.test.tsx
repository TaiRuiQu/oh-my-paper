// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import {
  ClassDetailPage,
  ClassEditPage,
  ClassListPage,
  StudentEditPage,
} from "@/components/platform/class-pages";

const mocks = vi.hoisted(() => ({ state: {} as PlatformState, mutate: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: mocks.state, mutate: mocks.mutate, pending: false, refresh: vi.fn() }),
}));
vi.mock("@/components/platform/account-import", () => ({
  AccountImport: () => createElement("div", { "data-testid": "account-import" }),
}));

const actors: { label: string; actor: PlatformState["actor"]; manageable: boolean }[] = [
  {
    label: "class owner",
    actor: { id: "owner", role: "TEACHER", name: "创建者" },
    manageable: true,
  },
  {
    label: "administrator",
    actor: { id: "admin", role: "ADMIN", name: "管理员" },
    manageable: true,
  },
  {
    label: "teacher without assignments",
    actor: { id: "other", role: "TEACHER", name: "教师" },
    manageable: false,
  },
  {
    label: "subject teacher",
    actor: {
      id: "other",
      role: "TEACHER",
      name: "任课教师",
      teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
    },
    manageable: false,
  },
  {
    label: "appointed homeroom teacher",
    actor: {
      id: "other",
      role: "TEACHER",
      name: "班主任",
      teachingAssignments: [{ role: "HOMEROOM", classroomId: "class" }],
    },
    manageable: false,
  },
  {
    label: "grade director",
    actor: {
      id: "other",
      role: "TEACHER",
      name: "年级主任",
      teachingAssignments: [{ role: "GRADE_DIRECTOR", stage: "初中", cohort: "2027届" }],
    },
    manageable: false,
  },
  {
    label: "school teaching administrator",
    actor: {
      id: "other",
      role: "TEACHER",
      name: "学校总管理",
      teachingAssignments: [{ role: "SCHOOL_ADMIN" }],
    },
    manageable: false,
  },
  {
    label: "student even when owner id matches",
    actor: { id: "owner", role: "STUDENT", name: "学生" },
    manageable: false,
  },
];
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.state = {
    actor: actors[0].actor,
    classrooms: [
      {
        id: "class",
        ownerId: "owner",
        name: "1班",
        stage: "初中",
        cohort: "2027届",
        students: [
          {
            id: "student",
            classroomId: "class",
            userId: "student-account",
            name: "小明",
            studentNumber: "123456",
          },
        ],
      },
    ],
    assessments: [],
    users: [],
  } as unknown as PlatformState;
  mocks.mutate.mockReset().mockResolvedValue({ id: "saved" });
  mocks.push.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(page: ReactElement) {
  await act(async () => root.render(page));
}

it.each(actors)(
  "matches server ownership rules for $label across every class surface",
  async ({ actor, manageable }) => {
    mocks.state.actor = actor;
    await render(createElement(ClassListPage));
    expect(!!container.querySelector('a[href="/workspace/classes/new"]')).toBe(
      actor.role !== "STUDENT",
    );
    expect(
      [...container.querySelectorAll("a")].some((link) => link.textContent === "管理学生"),
    ).toBe(manageable);
    if (actor.role === "TEACHER" && !manageable) {
      expect(container.textContent).toContain("查看学生");
      expect(container.textContent).toContain("只读");
    }
    for (const students of [false, true]) {
      await render(createElement(ClassDetailPage, { id: "class", students }));
      expect(!!container.querySelector('a[href$="/settings"]')).toBe(manageable);
      expect(!!container.querySelector('a[href$="/students/new"]')).toBe(manageable);
      expect(!!container.querySelector('a[href$="/student/edit"]')).toBe(manageable);
      expect(container.textContent?.includes("批量导入学生")).toBe(manageable);
      expect(container.textContent?.includes("移除")).toBe(manageable);
      if (actor.role === "TEACHER" && !manageable) {
        expect(container.textContent).toContain("由班级创建者或管理员维护");
        expect(container.textContent).toContain("小明");
        expect(
          container.querySelector('a[href="/workspace/classes/class/reports"]'),
        ).not.toBeNull();
      }
      if (actor.role === "STUDENT")
        expect(container.querySelector('a[href^="/workspace/classes"]')).toBeNull();
    }
    for (const page of [
      createElement(ClassEditPage, { id: "class" }),
      createElement(StudentEditPage, { classroomId: "class" }),
      createElement(StudentEditPage, { classroomId: "class", studentId: "student" }),
    ]) {
      await render(page);
      expect(!!container.querySelector("form")).toBe(manageable);
      if (!manageable) {
        expect(container.textContent).toContain(
          actor.role === "STUDENT" ? "学生账号只能查看本人学习数据" : "当前班级为只读",
        );
        expect(container.querySelector("input, select")).toBeNull();
      }
    }
    await render(createElement(ClassEditPage));
    expect(!!container.querySelector("form")).toBe(actor.role !== "STUDENT");
    expect(mocks.mutate).not.toHaveBeenCalled();
  },
);

it.each(actors.filter((row) => row.manageable))(
  "preserves saving and importing for $label",
  async ({ actor }) => {
    mocks.state.actor = actor;
    await render(createElement(ClassEditPage, { id: "class" }));
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({
      type: "classroom.save",
      classroom: { id: "class", name: "1班", stage: "初中", cohort: "2027届" },
    });
    await render(createElement(StudentEditPage, { classroomId: "class", studentId: "student" }));
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({
      type: "student.save",
      student: {
        id: "student",
        classroomId: "class",
        name: "小明",
        studentNumber: "123456",
        userId: undefined,
      },
    });
    await render(createElement(ClassDetailPage, { id: "class", students: true }));
    const importButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "批量导入学生",
    )!;
    await act(async () => importButton.click());
    expect(container.querySelector('[data-testid="account-import"]')).not.toBeNull();
  },
);
