// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Admin } from "@/components/platform/admin";
import type { PlatformState } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";

vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
vi.mock("@/components/platform/embedding-settings", () => ({ EmbeddingSettings: () => null }));
vi.mock("@/components/platform/account-import", () => ({ AccountImport: () => null }));

const api = vi.mocked(apiRequest);
const refresh = vi.fn(),
  notify = vi.fn();
const staff = {
  id: "teacher",
  name: "张老师",
  email: "teacher@test.invalid",
  username: "t2026001",
  role: "TEACHER" as const,
  permissionsVersion: 3,
  teachingAssignments: [],
};
const student = {
  id: "student",
  name: "张小明",
  email: "stu@test.invalid",
  username: "000123",
  role: "STUDENT" as const,
};
let host: HTMLDivElement, root: Root, state: PlatformState;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state = {
    actor: { id: "admin", role: "ADMIN" },
    users: [staff],
    usersTotal: 1024,
    classrooms: [],
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
function control(label: string) {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
async function fill(label: string, value: string) {
  const node = control(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(label: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
}

it("renders staff accounts from state without reading the directory and notes the hidden student total", async () => {
  await render();
  expect(host.querySelector("tbody")?.textContent).toContain("张老师");
  expect(api).toHaveBeenCalledTimes(1);
  expect(api.mock.calls[0][0]).toBe("/api/platform/admin");
  expect(host.textContent).toContain("全校共 1024 个账号");
});

it("searches accounts server-side and shows the truncation hint", async () => {
  api.mockImplementation((url) =>
    String(url).startsWith("/api/platform/users")
      ? Promise.resolve({ users: [student], total: 250 })
      : Promise.resolve({ providers: [] }),
  );
  await render();
  await fill("搜索账号", "小明");
  await act(async () => {});
  expect(api).toHaveBeenLastCalledWith(
    "/api/platform/users?query=%E5%B0%8F%E6%98%8E",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(host.querySelector("tbody")?.textContent).toContain("张小明");
  expect(host.querySelector("tbody")?.textContent).not.toContain("张老师");
  expect(host.textContent).toContain("找到 250 个账号");
  expect(host.textContent).toContain("仅显示最近创建的前 1 个");
});

it("filters by role and falls back to the explicit empty state", async () => {
  await render();
  api.mockResolvedValueOnce({ users: [], total: 0 });
  await choose("按角色筛选账号", "STUDENT");
  await act(async () => {});
  expect(api).toHaveBeenLastCalledWith(
    "/api/platform/users?role=STUDENT",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(host.textContent).toContain("该角色筛选下暂无账号。");
});

it("recovers with a retry after a failed directory read", async () => {
  await render();
  api.mockRejectedValueOnce(new Error("暂不可用"));
  await fill("搜索账号", "张");
  await act(async () => {});
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂不可用");
  api.mockResolvedValueOnce({ users: [student], total: 1 });
  await click("重试");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("tbody")?.textContent).toContain("张小明");
});

it("returns to the staff table after clearing the search", async () => {
  api.mockImplementation((url) =>
    String(url).startsWith("/api/platform/users")
      ? Promise.resolve({ users: [student], total: 1 })
      : Promise.resolve({ providers: [] }),
  );
  await render();
  await fill("搜索账号", "张");
  await act(async () => {});
  await click("清空搜索");
  expect(host.querySelector("tbody")?.textContent).toContain("张老师");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
