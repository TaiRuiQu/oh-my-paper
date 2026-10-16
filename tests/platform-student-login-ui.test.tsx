// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { ClassDetailPage, StudentEditPage } from "@/components/platform/class-pages";
import { apiRequest } from "@/lib/http-client";
const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state, mutate, pending: false, refresh: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
const api = vi.mocked(apiRequest);
let state: PlatformState, host: HTMLDivElement, root: Root;
const directoryUser = {
  id: "account",
  name: "小明",
  username: "009876",
  email: "account@accounts.invalid",
  role: "STUDENT" as const,
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.mockResolvedValue({ users: [] });
  mutate.mockResolvedValue({ id: "student-next" });
  state = {
    actor: { id: "owner", name: "创建者", role: "TEACHER" },
    classrooms: [
      {
        id: "class",
        ownerId: "owner",
        name: "一班",
        stage: "高中",
        cohort: "2027届",
        students: [
          {
            id: "student",
            classroomId: "class",
            name: "小明",
            studentNumber: "000001",
            userId: "account",
            userLogin: "009876",
          },
        ],
      },
    ],
    users: [],
    questions: [],
    papers: [],
    assessments: [],
    submissions: [],
    reviews: [],
    templates: [],
    analytics: { results: [], students: [], classrooms: [], knowledge: [] },
  } as unknown as PlatformState;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function input(label: string) {
  return [...host.querySelectorAll("label")].find(
    (node) => node.querySelector("span")?.textContent === label,
  )!;
}
async function fill(label: string, value: string) {
  const control = input(label).querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(label: string) {
  return host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
}
it("shows the preserved answer-card number and the actual distinct login in the roster", async () => {
  await act(async () => root.render(<ClassDetailPage id="class" students />));
  const cells = [...host.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes("小明"),
  );
  expect(cells?.textContent).toContain("000001");
  expect(cells?.textContent).toContain("已绑定 · 登录账号：009876");
});
it("falls back to an explicit placeholder when the roster misses the bound login", async () => {
  (state.classrooms[0].students[0] as { userLogin?: string }).userLogin = undefined;
  await act(async () => root.render(<ClassDetailPage id="class" students />));
  expect(host.textContent).toContain("已绑定 · 登录账号：账号信息暂不可用");
});
it("labels the read-only login separately while preserving a historical answer-card number", async () => {
  await act(async () => root.render(<StudentEditPage classroomId="class" studentId="student" />));
  expect(host.querySelector<HTMLInputElement>('input[name="studentNumber"]')?.value).toBe("000001");
  const login = [...host.querySelectorAll("input")].find((input) => input.value === "009876");
  expect(login?.readOnly).toBe(true);
  expect(host.textContent).toContain("登录账号");
  expect(host.textContent).not.toContain("学生以学号登录");
  expect(host.textContent).toContain("学号 / 卡号单独用于答题身份匹配");
});
it("binds an existing account through server-side search instead of a full option list", async () => {
  api.mockResolvedValueOnce({ users: [directoryUser], total: 1 });
  await act(async () => root.render(<StudentEditPage classroomId="class" />));
  expect(host.querySelector('select[name="userId"]')).toBeNull();
  expect(api).not.toHaveBeenCalled();
  await fill("已有学生账号（可选）", "小明");
  await act(async () => {});
  expect(api).toHaveBeenLastCalledWith(
    "/api/platform/users?role=STUDENT&query=%E5%B0%8F%E6%98%8E",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await act(async () => button("选择学生账号 小明")!.click());
  expect(host.textContent).toContain("已选定账号");
  expect(host.querySelector<HTMLInputElement>('input[name="studentNumber"]')?.value).toBe("");
  await act(async () => {
    input("真实姓名").querySelector("input")!.value = "小明";
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "student.save",
      student: expect.objectContaining({ classroomId: "class", name: "小明", userId: "account" }),
    }),
  );
});
it("keeps the unbound flow after an explicit reselection", async () => {
  api.mockResolvedValueOnce({ users: [directoryUser], total: 1 });
  await act(async () => root.render(<StudentEditPage classroomId="class" />));
  await fill("已有学生账号（可选）", "009876");
  await act(async () => {});
  await act(async () => button("选择学生账号 小明")!.click());
  await act(async () => button("重新搜索学生账号")!.click());
  expect(host.textContent).not.toContain("已选定账号");
  await act(async () => {
    input("真实姓名").querySelector("input")!.value = "新同学";
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const command = mutate.mock.calls[0][0] as {
    student: { userId?: string | null };
  };
  expect(command.student.userId).toBeUndefined();
});
it("reports a failed directory search without blocking the new-account flow", async () => {
  api.mockRejectedValueOnce(new Error("账号读取失败"));
  await act(async () => root.render(<StudentEditPage classroomId="class" />));
  await fill("已有学生账号（可选）", "小明");
  await act(async () => {});
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("账号读取失败");
  expect(host.textContent).toContain("留空沿用其数字账号");
});
