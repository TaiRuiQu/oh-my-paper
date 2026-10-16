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
const provider = {
  id: "provider",
  name: "学校模型",
  apiType: "openai_chat",
  baseURL: "https://example.test",
  maxOutputTokens: 16384,
  transportMode: "http",
  models: [],
};
const refresh = vi.fn(),
  notify = vi.fn();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  refresh.mockResolvedValue(undefined);
  vi.mocked(apiRequest).mockResolvedValue({ providers: [provider] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(section: "users" | "models") {
  await act(async () =>
    root.render(
      <Admin
        section={section}
        state={{ actor: { id: "admin" }, users: [], classrooms: [] } as unknown as PlatformState}
        refresh={refresh}
        notify={notify}
      />,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
function posts() {
  return vi.mocked(apiRequest).mock.calls.filter(([, options]) => options?.method === "POST");
}
async function submitTwice(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("keeps created credentials and retries only reads after a successful account POST", async () => {
  await render("users");
  await act(async () => button("添加学生").click());
  host.querySelector<HTMLInputElement>('[name="name"]')!.value = "新同学";
  refresh.mockRejectedValue(new Error("平台读取失败"));
  vi.mocked(apiRequest).mockResolvedValue({
    credentials: { username: "123456", password: "test-created-password" },
  });
  await submitTwice(host.querySelector("form")!);
  expect(posts()).toHaveLength(1);
  expect(host.textContent).toContain("已收到保存回执");
  expect(host.textContent).toContain("平台读取失败");
  expect(host.textContent).toContain("test-created-password");
  expect(button("添加学生").disabled).toBe(true);
  await act(async () => button("重新读取最新配置").click());
  expect(posts()).toHaveLength(1);
  expect(host.textContent).toContain("123456");
  refresh.mockResolvedValue(undefined);
  vi.mocked(apiRequest).mockResolvedValue({ providers: [] });
  await act(async () => button("重新读取最新配置").click());
  expect(posts()).toHaveLength(1);
  expect(host.textContent).not.toContain("已收到保存回执");
  expect(host.textContent).toContain("test-created-password");
  expect(button("添加学生").disabled).toBe(false);
  expect(notify).not.toHaveBeenCalledWith("平台读取失败", true);
});

it("retains a deleted-provider receipt when the second refresh GET fails", async () => {
  await render("models");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(apiRequest).mockImplementation((_url, options) =>
    options?.method === "POST"
      ? Promise.resolve({ id: provider.id })
      : Promise.reject(new Error("模型列表读取失败")),
  );
  await act(async () => button("删除").click());
  expect(host.textContent).toContain("AI 供应商已删除。");
  expect(host.textContent).toContain("模型列表读取失败");
  expect(button("删除").disabled).toBe(true);
  expect(button("编辑").disabled).toBe(true);
  vi.mocked(apiRequest).mockResolvedValue({ providers: [] });
  await act(async () => button("重新读取最新配置").click());
  expect(posts()).toHaveLength(1);
  expect(host.textContent).toContain("尚未配置模型提供商");
  expect(notify).toHaveBeenCalledWith("AI 供应商已删除。");
});

it("keeps a rejected provider form editable and allows a deliberate POST retry", async () => {
  await render("models");
  await act(async () => button("编辑").click());
  const form = host.querySelector("form")!;
  host.querySelector<HTMLInputElement>('[name="name"]')!.value = "修改后的配置";
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error("服务器拒绝修改"));
  await submitTwice(form);
  expect(posts()).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe("修改后的配置");
  expect(form.hasAttribute("inert")).toBe(false);
  expect(host.textContent).not.toContain("已收到保存回执");
  expect(notify).toHaveBeenCalledWith("服务器拒绝修改", true);
  vi.mocked(apiRequest).mockResolvedValue({ providers: [provider] });
  await submitTwice(form);
  expect(posts()).toHaveLength(2);
  expect(JSON.parse(String(posts()[1][1]?.body)).provider.name).toBe("修改后的配置");
});

it("locks the acknowledged form synchronously against reentry before React commits stale state", async () => {
  await render("models");
  await act(async () => button("编辑").click());
  const form = host.querySelector("form")!;
  refresh.mockImplementation(async () => {
    throw new Error("暂不可读");
  });
  vi.mocked(apiRequest).mockImplementation(async (_url, options) => {
    if (options?.method === "POST") {
      queueMicrotask(() =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      return { id: provider.id };
    }
    return { providers: [provider] };
  });
  await submitTwice(form);
  expect(posts()).toHaveLength(1);
  expect(form.hasAttribute("inert")).toBe(true);
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(posts()).toHaveLength(1);
});
