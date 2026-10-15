// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAI } from "@/components/platform/ai";
import type { PlatformState } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { uploadDocument } from "@/lib/document-upload";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
vi.mock("@/lib/document-upload", () => ({ uploadDocument: vi.fn() }));
vi.mock("@/components/platform/ai-job-list", () => ({ AIJobList: () => null }));
vi.mock("@/components/platform/question-bank-picker", () => ({
  useQuestionPage: () => ({ questions: [], total: 0 }),
}));

let container: HTMLDivElement, root: Root;
const refresh = vi.fn(async () => {}),
  notify = vi.fn();
beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(apiRequest).mockResolvedValue({
    id: "job",
    models: [{ id: "model", name: "模型" }],
    jobs: [],
  });
  vi.mocked(uploadDocument).mockResolvedValue({
    id: "document",
    url: "/api/platform/assets/page",
    pageCount: 1,
    pages: [{ id: "page", url: "/api/platform/assets/page", name: "作业.png", size: 5, page: 1 }],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <PlatformAI
        state={{} as PlatformState}
        tab="questions"
        importKind="HOMEWORK"
        refresh={refresh}
        notify={notify}
      />,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
function field<T extends HTMLSelectElement | HTMLInputElement>(label: string): T {
  const wrapper = [...container.querySelectorAll("label")].find(
    (node) => node.querySelector("span")?.textContent === label,
  );
  return wrapper!.querySelector<T>("select, input")!;
}
async function select(label: string, value: string) {
  await act(async () => {
    const input = field<HTMLSelectElement>(label);
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], "作业.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "识别并创建作业")!
      .click();
  });
}
function submittedInput() {
  const request = vi
    .mocked(apiRequest)
    .mock.calls.find(([, options]) => options?.method === "POST");
  return JSON.parse(String(request![1]!.body)).input;
}

it("defaults all three fields to AI recognition and submits without manual metadata", async () => {
  for (const label of ["作业名称", "导入学科", "适用年级"]) {
    const control = field<HTMLSelectElement>(label);
    expect(control.selectedOptions[0].textContent).toBe("AI 自动识别（推荐）");
  }
  await submit();
  expect(submittedInput()).toEqual({ assetUrls: ["/api/platform/assets/page"], kind: "HOMEWORK" });
  expect(push).toHaveBeenCalled();
});

it("supports manual title, subject and grade independently", async () => {
  await select("作业名称", "manual");
  await act(async () => {
    const input = field<HTMLInputElement>("填写作业名称");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "  英语练习  ",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await select("适用年级", "小学三年级");
  await submit();
  expect(submittedInput()).toEqual({
    assetUrls: ["/api/platform/assets/page"],
    kind: "HOMEWORK",
    name: "英语练习",
    grade: "小学三年级",
  });
});

it("can return every field to automatic recognition after manual edits", async () => {
  await select("作业名称", "manual");
  await select("导入学科", "英语");
  await select("适用年级", "小学三年级");
  await select("作业名称", "auto");
  await select("导入学科", "");
  await select("适用年级", "");
  await submit();
  expect(submittedInput()).toEqual({ assetUrls: ["/api/platform/assets/page"], kind: "HOMEWORK" });
});

it("can specify just the subject while AI identifies the title and grade", async () => {
  await select("导入学科", "英语");
  await submit();
  expect(submittedInput()).toEqual({
    assetUrls: ["/api/platform/assets/page"],
    kind: "HOMEWORK",
    subject: "英语",
  });
});

it("requires a title when the user chooses manual entry before uploading", async () => {
  await select("作业名称", "manual");
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("请输入名称");
  expect(uploadDocument).not.toHaveBeenCalled();
});

it.each(["image/png", "application/pdf"])(
  "creates an exam paper from %s and retains expanded page order",
  async (type) => {
    await act(async () =>
      root.render(
        <PlatformAI
          state={{} as PlatformState}
          tab="questions"
          importKind="EXAM"
          refresh={refresh}
          notify={notify}
        />,
      ),
    );
    const urls = ["first", "second", "third"].map((id) => `/api/platform/assets/${id}`);
    vi.mocked(uploadDocument).mockResolvedValue({
      id: "exam-document",
      url: urls[0],
      pageCount: 3,
      pages: urls.map((url, i) => ({
        id: String(i),
        url,
        page: i + 1,
        name: `试卷第${i + 1}页`,
        size: 5,
      })),
    });
    expect(field<HTMLSelectElement>("试卷名称").value).toBe("auto");
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(input.accept).toContain(".pdf");
      expect(input.multiple).toBe(true);
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["exam"], type === "application/pdf" ? "试卷.pdf" : "试卷.png", { type })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "识别并创建试卷")!
        .click(),
    );
    expect(uploadDocument).toHaveBeenCalledWith(expect.any(File), 20);
    expect(submittedInput()).toEqual({ assetUrls: urls, kind: "EXAM" });
    expect(push).toHaveBeenCalledWith("/workspace/ai/job");
  },
);
