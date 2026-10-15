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
  models: [{ id: "m", name: "教学模型" }],
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
