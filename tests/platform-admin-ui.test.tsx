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
const provider = {
  id: "p",
  name: "学校模型服务",
  apiType: "openai_chat",
  baseURL: "https://example.test/v1",
  maxOutputTokens: 16384,
  models: [{ id: "m", name: "model-api-id", displayName: "教学模型", reasoningEffort: "high" }],
};
let container: HTMLDivElement, root: Root;
const notify = vi.fn(),
  refresh = vi.fn(async () => {});
async function renderAdmin() {
  await act(async () =>
    root.render(
      <Admin
        section="models"
        state={{ users: [] } as unknown as PlatformState}
        notify={notify}
        refresh={refresh}
      />,
    ),
  );
}
function deleteButton() {
  return container.querySelector<HTMLButtonElement>('[aria-label="删除 AI 供应商 学校模型服务"]')!;
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(apiRequest).mockResolvedValue({ providers: [provider] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
it("names the supplier and associated models in confirmation and does nothing after cancel", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await renderAdmin();
  await act(async () => deleteButton().click());
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/学校模型服务.*1 个模型/));
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});
it("disables duplicate operations while deleting, refreshes the list and reports success", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await renderAdmin();
  let finish!: () => void;
  vi.mocked(apiRequest).mockImplementation((_url, options) => {
    if (options?.method === "POST")
      return new Promise((resolve) => {
        finish = () => resolve({ id: "p" });
      });
    return Promise.resolve({ providers: [] });
  });
  await act(async () => deleteButton().click());
  expect(deleteButton().disabled).toBe(true);
  expect(apiRequest).toHaveBeenLastCalledWith(
    "/api/platform/admin",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ type: "provider.delete", id: "p" }),
    }),
  );
  await act(async () => finish());
  expect(container.textContent).toContain("尚未配置模型提供商");
  expect(notify).toHaveBeenCalledWith("AI 供应商已删除。");
  expect(refresh).toHaveBeenCalledOnce();
});
it("preserves the supplier and allows retry after the server rejects deletion", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await renderAdmin();
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error("需要管理员权限。"));
  await act(async () => deleteButton().click());
  expect(notify).toHaveBeenCalledWith("需要管理员权限。", true);
  expect(deleteButton().disabled).toBe(false);
});

it("edits, adds and removes model rows and saves IDs separately from display names", async () => {
  await renderAdmin();
  expect(container.querySelector("tbody ul li")?.textContent).toBe("教学模型model-api-id");
  const findButton = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => findButton("编辑").click());
  expect(container.querySelector<HTMLInputElement>('[name="modelName"]')!.value).toBe(
    "model-api-id",
  );
  expect(container.querySelector<HTMLInputElement>('[name="modelDisplayName"]')!.value).toBe(
    "教学模型",
  );
  expect(container.querySelector<HTMLSelectElement>('[name="modelReasoningEffort"]')!.value).toBe(
    "high",
  );
  await act(async () => findButton("添加模型").click());
  expect(
    container.querySelectorAll<HTMLSelectElement>('[name="modelReasoningEffort"]')[1].value,
  ).toBe("provider-default");
  async function fill(name: string, index: number, value: string) {
    const input = container.querySelectorAll<HTMLInputElement>(`[name="${name}"]`)[index];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await fill("modelName", 1, "vendor/model,with-comma");
  await fill("modelDisplayName", 1, "课堂模型");
  await act(async () => {
    const select = container.querySelectorAll<HTMLSelectElement>(
      '[name="modelReasoningEffort"]',
    )[1];
    select.value = "xhigh";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="删除模型 1"]')!.click(),
  );
  expect(container.querySelectorAll('[name="modelName"]')).toHaveLength(1);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const request = vi
    .mocked(apiRequest)
    .mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(JSON.parse(String(request[1]!.body)).provider.models).toEqual([
    { name: "vendor/model,with-comma", displayName: "课堂模型", reasoningEffort: "xhigh" },
  ]);
});

it.each(["http", "websocket"])(
  "loads and saves transport mode %s only for Responses",
  async (transportMode) => {
    vi.mocked(apiRequest).mockResolvedValue({
      providers: [{ ...provider, apiType: "openai_responses", transportMode }],
    });
    await renderAdmin();
    const edit = [...container.querySelectorAll("button")].find((b) => b.textContent === "编辑")!;
    await act(async () => edit.click());
    const choice = container.querySelector<HTMLSelectElement>('[name="transportMode"]')!;
    expect(choice.value).toBe(transportMode);
    expect(container.textContent).not.toMatch(/previous_response_id|previous response/i);
    expect([...choice.options].map((option) => option.textContent)).toEqual([
      "HTTP 模式",
      "WebSocket 模式",
    ]);
    const nextMode = transportMode === "http" ? "websocket" : "http";
    await act(async () => {
      choice.value = nextMode;
      choice.dispatchEvent(new Event("change", { bubbles: true }));
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const request = vi
      .mocked(apiRequest)
      .mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(String(request[1]!.body)).provider.transportMode).toBe(nextMode);
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "编辑")!.click(),
    );
    const apiType = container.querySelector<HTMLSelectElement>('[name="apiType"]')!;
    await act(async () => {
      apiType.value = "anthropic";
      apiType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[name="transportMode"]')).toBeNull();
    await act(async () => {
      apiType.value = "openai_responses";
      apiType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector<HTMLSelectElement>('[name="transportMode"]')!.value).toBe(
      transportMode,
    );
  },
);
