// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountImport } from "@/components/platform/account-import";
import { apiRequest } from "@/lib/http-client";
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
let container: HTMLDivElement, root: Root;
const refresh = vi.fn(async () => {}),
  close = vi.fn();
const rows = [{ row: 2, name: "张三", studentNumber: "000001", username: "", password: "" }];
beforeEach(async () => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <AccountImport role="STUDENT" classroomId="class" refresh={refresh} onClose={close} />,
    ),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});
const button = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("确认导入"))!;
async function upload() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["姓名,学号\n张三,000001"], "students.csv")],
    configurable: true,
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
it("previews before committing, blocks rows with issues, and includes the target class", async () => {
  expect(button().disabled).toBe(true);
  vi.mocked(apiRequest).mockResolvedValue({ rows, issues: [{ row: 2, message: "学号已存在" }] });
  await upload();
  expect(container.textContent).toContain("第 2 行：学号已存在");
  expect(button().disabled).toBe(true);
  vi.mocked(apiRequest).mockResolvedValue({ rows, issues: [] });
  await upload();
  expect(button().disabled).toBe(false);
  expect(container.textContent).toContain("000001");
  vi.mocked(apiRequest).mockResolvedValue({
    accounts: [{ row: 2, name: "张三", username: "000001", password: "generated123" }],
  });
  await act(async () => button().click());
  expect(apiRequest).toHaveBeenLastCalledWith(
    "/api/platform/accounts/import",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ role: "STUDENT", classroomId: "class", rows }),
    }),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("已成功导入 1 个学生账号，并加入当前班级");
  expect(container.textContent).toContain("下载登录信息");
  expect(button()).toBeUndefined();
});
it("preserves the committed credentials if refreshing the list fails", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ rows, issues: [] })
    .mockResolvedValueOnce({
      accounts: [{ row: 2, name: "张三", username: "000001", password: "generated123" }],
    });
  refresh.mockRejectedValueOnce(new Error("offline"));
  await upload();
  await act(async () => button().click());
  expect(container.textContent).toContain("账号已导入，名单刷新失败");
  expect(container.textContent).toContain("下载登录信息");
  expect(button()).toBeUndefined();
});
it("disables duplicate submissions while importing, then permits retry on failure", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ rows, issues: [] });
  await upload();
  let reject!: (error: Error) => void;
  vi.mocked(apiRequest).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    button().click();
    button().click();
  });
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
  await act(async () => reject(new Error("第 2 行：账号已存在")));
  expect(container.textContent).toContain("第 2 行：账号已存在");
  expect(button().disabled).toBe(false);
});

it("keeps credentials available and allows retry when the Excel download fails", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ rows, issues: [] })
    .mockResolvedValueOnce({
      accounts: [{ row: 2, name: "张三", username: "000001", password: "-Password123" }],
    });
  await upload();
  await act(async () => button().click());
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: false, json: async () => ({ error: "下载失败，请重试。" }) });
  vi.stubGlobal("fetch", fetchMock);
  const download = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "下载登录信息（Excel）",
  )!;
  await act(async () => download.click());
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("download=credentials"),
    expect.objectContaining({ method: "POST" }),
  );
  expect(container.textContent).toContain("下载失败，请重试。");
  expect(container.textContent).toContain("已成功导入 1 个学生账号");
  expect(download.disabled).toBe(false);
});
