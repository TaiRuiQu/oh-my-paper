// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Admin } from "@/components/platform/admin";
import type { PlatformState } from "@/contracts/platform";
import type { TeachingPermissionsHistory } from "@/contracts/permissions";
import { apiRequest } from "@/lib/http-client";
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
vi.mock("@/components/platform/embedding-settings", () => ({ EmbeddingSettings: () => null }));
vi.mock("@/components/platform/account-import", () => ({ AccountImport: () => null }));
const refresh = vi.fn(),
  notify = vi.fn();
let host: HTMLDivElement, root: Root, state: PlatformState;
const api = vi.mocked(apiRequest);
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state = {
    actor: { id: "admin", role: "ADMIN" },
    users: [
      {
        id: "teacher",
        name: "张老师",
        role: "TEACHER",
        permissionsVersion: 5,
        teachingAssignments: [{ role: "HOMEROOM", classroomId: "a" }],
      },
    ],
    classrooms: [
      { id: "a", name: "一班", stage: "高中", cohort: "2027届", students: [] },
      { id: "b", name: "二班", stage: "高中", cohort: "2027届", students: [] },
    ],
  } as unknown as PlatformState;
  refresh.mockResolvedValue(undefined);
  api.mockResolvedValue({ providers: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(<Admin section="users" state={state} refresh={refresh} notify={notify} />),
  );
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function field(label: string) {
  const node = [...host.querySelectorAll("label")].find(
    (labelNode) => labelNode.querySelector("span")?.textContent === label,
  )!;
  return node.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input,select,textarea",
  )!;
}
async function fill(label: string, value: string) {
  const control = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!.set!.call(
      control,
      value,
    );
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
const commands = () =>
  api.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init!.body)));
const conflict = (message = "权限版本冲突") => Object.assign(new Error(message), { status: 409 });

it("requires a reason and sends the exact captured permissions version and whole selection", async () => {
  await render();
  await click("配置教学权限");
  expect(button("保存教学权限").disabled).toBe(true);
  await fill("身份 1 的班级", "b");
  await fill("变更原因", "  新学期调整班主任  ");
  let finish!: (result: unknown) => void;
  api.mockImplementation((_url, init) =>
    init?.method === "POST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ providers: [] }),
  );
  const form = host.querySelector<HTMLFormElement>('form[aria-label="张老师的教学权限"]')!;
  await act(async () => {
    form.requestSubmit();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(commands()).toEqual([
    {
      type: "user.permissions",
      id: "teacher",
      expectedVersion: 5,
      reason: "新学期调整班主任",
      assignments: [{ role: "HOMEROOM", classroomId: "b" }],
    },
  ]);
  expect(form.querySelector("fieldset")!.disabled).toBe(true);
  refresh.mockRejectedValue(new Error("最新资料暂不可读"));
  await act(async () => finish({ id: "teacher", permissionsVersion: 6 }));
  expect(host.textContent).toContain("已收到保存回执");
  expect(host.textContent).toContain("最新资料暂不可读");
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(commands()).toHaveLength(1);
});

it("keeps the conflicted draft across read failures and requires explicit comparison/adoption before a new baseline", async () => {
  await render();
  await click("配置教学权限");
  await fill("身份 1 的班级", "b");
  await fill("变更原因", "未提交的原原因");
  api.mockRejectedValueOnce(conflict("权限版本冲突。"));
  await click("保存教学权限");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "权限版本冲突。当前选择与原因仍保留。",
  );
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("。。");
  expect(field("身份 1 的班级").value).toBe("b");
  expect(field("变更原因").value).toBe("未提交的原原因");
  expect(button("保存教学权限").disabled).toBe(true);
  api.mockRejectedValueOnce(new Error("比较读取失败"));
  await click("读取最新权限并比较");
  expect(host.textContent).toContain("比较读取失败");
  expect(field("变更原因").value).toBe("未提交的原原因");
  const latest = {
    ...state.users[0],
    permissionsVersion: 7,
    teachingAssignments: [{ role: "SCHOOL_ADMIN" }],
  };
  api.mockResolvedValueOnce({ users: [latest], total: 1 });
  await click("读取最新权限并比较");
  expect(host.textContent).toContain("服务器最新权限 v7");
  expect(field("身份 1 的班级").value).toBe("b");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("采用最新权限重新编辑");
  expect(field("变更原因").value).toBe("未提交的原原因");
  confirm.mockReturnValue(true);
  await click("采用最新权限重新编辑");
  expect(field("身份 1").value).toBe("SCHOOL_ADMIN");
  expect(field("变更原因").value).toBe("");
  expect(commands()).toHaveLength(1);
  await fill("变更原因", "核对最新版本后明确调整");
  api.mockResolvedValue({ providers: [], id: "teacher", permissionsVersion: 8 });
  await click("保存教学权限");
  expect(commands()[1]).toEqual({
    type: "user.permissions",
    id: "teacher",
    expectedVersion: 7,
    reason: "核对最新版本后明确调整",
    assignments: [{ role: "SCHOOL_ADMIN" }],
  });
});

it("does not silently rebase an open editor when the parent refreshes its users", async () => {
  await render();
  await click("配置教学权限");
  await fill("身份 1 的班级", "b");
  await fill("变更原因", "保留原基线");
  state = {
    ...state,
    users: [
      { ...state.users[0], permissionsVersion: 9, teachingAssignments: [{ role: "SCHOOL_ADMIN" }] },
    ],
  };
  await render();
  await click("保存教学权限");
  expect(commands()[0]).toMatchObject({
    expectedVersion: 5,
    assignments: [{ role: "HOMEROOM", classroomId: "b" }],
  });
});

it("never guesses version zero for missing metadata and makes the real version explicitly adoptable", async () => {
  delete state.users[0].permissionsVersion;
  await render();
  await click("配置教学权限");
  expect(button("保存教学权限").disabled).toBe(true);
  expect(host.textContent).toContain("编辑基于权限版本 未知");
  api.mockResolvedValueOnce({ users: [{ ...state.users[0], permissionsVersion: 0 }], total: 1 });
  await click("读取最新权限并比较");
  expect(api).toHaveBeenLastCalledWith(
    "/api/platform/users?id=teacher",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await click("采用最新权限重新编辑");
  await fill("变更原因", "首次核对授权");
  await click("保存教学权限");
  expect(commands()[0]).toMatchObject({ expectedVersion: 0, reason: "首次核对授权" });
});

it("opens a role confirmation instead of writing from a select change and requires its captured version/reason", async () => {
  await render();
  const select = host.querySelector<HTMLSelectElement>('[aria-label="张老师 的角色"]')!;
  await act(async () => {
    select.value = "ADMIN";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(commands()).toHaveLength(0);
  expect(field("账号角色").value).toBe("ADMIN");
  expect(button("确认角色变更").disabled).toBe(true);
  await fill("变更原因", "学校任命管理职责");
  api.mockRejectedValueOnce(conflict());
  await click("确认角色变更");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "权限版本冲突。当前选择与原因仍保留。",
  );
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("。。");
  expect(commands()[0]).toEqual({
    type: "user.role",
    id: "teacher",
    role: "ADMIN",
    expectedVersion: 5,
    reason: "学校任命管理职责",
  });
  expect(field("账号角色").value).toBe("ADMIN");
  expect(field("变更原因").value).toBe("学校任命管理职责");
  expect(button("确认角色变更").disabled).toBe(true);
});

it("protects unsaved permission cancellation and leaves no dirty guard after an explicit discard", async () => {
  await render();
  await click("配置教学权限");
  await fill("变更原因", "还没保存");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("取消");
  expect(host.querySelector('form[aria-label="张老师的教学权限"]')).not.toBeNull();
  confirm.mockReturnValue(true);
  await click("取消");
  expect(host.querySelector('form[aria-label="张老师的教学权限"]')).toBeNull();
  expect(commands()).toHaveLength(0);
});

it("keeps teaching permissions read-only after adopting a concurrent change to a nonteacher role", async () => {
  await render();
  await click("配置教学权限");
  await fill("变更原因", "原本想修改权限");
  api.mockRejectedValueOnce(conflict());
  await click("保存教学权限");
  api.mockResolvedValueOnce({
    users: [{ ...state.users[0], role: "STUDENT", permissionsVersion: 8, teachingAssignments: [] }],
    total: 1,
  });
  await click("读取最新权限并比较");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await click("采用最新权限重新编辑");
  expect(host.textContent).toContain("账号已不再是教师");
  expect(button("保存教学权限").disabled).toBe(true);
  expect(field("变更原因").value).toBe("");
  await click("取消");
  expect(host.querySelector('form[aria-label="张老师的教学权限"]')).toBeNull();
  expect(commands()).toHaveLength(1);
});

it("reads immutable named audit snapshots, recovers from failure and appends older history by its opaque cursor", async () => {
  await render();
  api.mockRejectedValueOnce(new Error("历史读取失败"));
  await click("查看变更历史");
  expect(host.textContent).toContain("历史读取失败");
  const event = {
    id: "event-6",
    type: "user.permissions" as const,
    version: 6,
    actorId: "old-admin",
    actorName: "原管理员",
    targetId: "teacher",
    targetName: "张老师",
    before: {
      role: "TEACHER" as const,
      assignments: [{ role: "HOMEROOM" as const, classroomId: "a" }],
    },
    after: { role: "TEACHER" as const, assignments: [{ role: "SCHOOL_ADMIN" as const }] },
    reason: "原任命依据",
    createdAt: "2026-10-15T00:00:00Z",
  };
  const history: TeachingPermissionsHistory = {
    user: { id: "teacher", name: "张老师", role: "TEACHER", permissionsVersion: 6 },
    events: [event],
    nextBeforeId: "opaque-cursor",
  };
  api.mockResolvedValueOnce(history);
  await click("重新读取变更历史");
  expect(host.textContent).toContain("原管理员");
  expect(host.textContent).toContain("原任命依据");
  expect(host.textContent).toContain("变更前");
  expect(host.textContent).toContain("班主任");
  expect(host.textContent).toContain("学校总管理");
  api.mockResolvedValueOnce({
    ...history,
    events: [{ ...event, id: "event-4", version: 4, type: "classroom.save" }],
    nextBeforeId: null,
  });
  await click("读取更早变更");
  expect(api).toHaveBeenLastCalledWith(
    "/api/platform/admin/permissions/teacher/history?beforeId=opaque-cursor",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(host.querySelectorAll("article")).toHaveLength(2);
  expect(host.textContent).toContain("新建班级自动配置身份");
  expect(commands()).toHaveLength(0);
});
