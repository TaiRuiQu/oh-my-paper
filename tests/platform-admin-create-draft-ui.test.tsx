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
vi.mock("@/components/platform/account-import", () => ({
  AccountImport: ({ role }: { role: string }) => <p>导入{role}</p>,
}));
const state = { actor: { id: "admin" }, users: [], classrooms: [] } as unknown as PlatformState;
const refresh = vi.fn(),
  notify = vi.fn();
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(apiRequest).mockResolvedValue({ providers: [] });
  refresh.mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function button(text: string) {
  return [...host.querySelectorAll("button")].find((element) => element.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function input(name: string) {
  return host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}
async function type(name: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(name),
      value,
    );
    input(name).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render(role = "教师") {
  await act(async () =>
    root.render(<Admin state={state} refresh={refresh} notify={notify} section="users" />),
  );
  await click(`添加${role}`);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function posts() {
  return vi.mocked(apiRequest).mock.calls.filter(([, options]) => options?.method === "POST");
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it.each(["取消", "添加学生", "添加管理员", "批量导入教师", "批量导入学生"])(
  "preserves the exact dirty form when abandoning via %s is declined",
  async (action) => {
    await render();
    await type("username", "r4_unsaved_draft");
    await type("password", "unsaved-password");
    const form = host.querySelector("form");
    await click(action);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(host.querySelector("form")).toBe(form);
    expect(input("username").value).toBe("r4_unsaved_draft");
    expect(input("password").value).toBe("unsaved-password");
    expect(unload()).toBe(true);
    expect(posts()).toHaveLength(0);
  },
);
it("guards student identity fields and allows an explicitly accepted type change", async () => {
  await render("学生");
  await type("name", "未保存同学");
  await type("studentNumber", "123456");
  await click("添加教师");
  expect(input("name").value).toBe("未保存同学");
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("添加教师");
  expect(input("username").value).toBe("");
  expect(unload()).toBe(false);
});
it("does not discard a draft when the current account type is selected again", async () => {
  await render();
  await type("username", "same_type");
  const form = host.querySelector("form");
  await click("添加教师");
  expect(host.querySelector("form")).toBe(form);
  expect(input("username").value).toBe("same_type");
  expect(window.confirm).not.toHaveBeenCalled();
});
it("blocks page navigation and unload until the draft is explicitly discarded", async () => {
  await render();
  await type("username", "stay_here");
  const link = document.createElement("a");
  link.href = "/admin/models";
  host.append(link);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => link.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(unload()).toBe(true);
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("取消");
  expect(host.querySelector("form")).toBeNull();
  expect(unload()).toBe(false);
});
it("keeps a rejected create editable and dirty, then clears the draft after a confirmed POST even if refresh fails", async () => {
  await render();
  await type("username", "retry_account");
  await type("password", "retry-password");
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error("账号已存在"));
  await submit();
  expect(input("username").value).toBe("retry_account");
  expect(unload()).toBe(true);
  expect(host.querySelector("form")!.hasAttribute("inert")).toBe(false);
  refresh.mockRejectedValue(new Error("读取失败"));
  vi.mocked(apiRequest).mockResolvedValue({
    credentials: { username: "retry_account", password: "created-password" },
  });
  await submit();
  expect(posts()).toHaveLength(2);
  expect(host.querySelector("form")).toBeNull();
  expect(unload()).toBe(false);
  expect(host.textContent).toContain("已收到保存回执");
  expect(host.textContent).toContain("created-password");
  expect(button("添加教师").disabled).toBe(true);
  await click("重新读取最新配置");
  expect(posts()).toHaveLength(2);
});
it("freezes all exits and prevents double POST while the create request is pending", async () => {
  await render();
  await type("username", "pending_account");
  await type("password", "pending-password");
  let accept!: (result: object) => void;
  vi.mocked(apiRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  await submit();
  await submit();
  expect(posts()).toHaveLength(1);
  expect(host.querySelector("form")!.hasAttribute("inert")).toBe(true);
  for (const text of ["取消", "添加教师", "添加学生", "批量导入教师"])
    expect(button(text).disabled).toBe(true);
  await act(async () => accept({}));
  expect(host.querySelector("form")).toBeNull();
  expect(unload()).toBe(false);
});
