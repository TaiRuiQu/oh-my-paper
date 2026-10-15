// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@/components/platform/analytics";
import { Scans } from "@/components/platform/scans";
import type { Analytics as AnalyticsData, PlatformState, Paper } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { generateCardTemplate } from "@/lib/cards";
vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const paper: Paper = {
  id: "paper",
  ownerId: "teacher",
  name: "试卷",
  kind: "EXAM",
  subject: "数学",
  grade: "高一",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  items: [
    {
      id: "item",
      position: 0,
      questionId: "q",
      score: 5,
      section: "",
      snapshot: {
        id: "q",
        ownerId: "teacher",
        grade: "高一",
        difficulty: 0.5,
        createdAt: "",
        updatedAt: "",
        type: "BLANK",
        subject: "数学",
        knowledgeTags: ["知识点"],
        content: {
          stem: "题干",
          options: [],
          answers: ["2"],
          parts: [],
          images: [],
          explanation: "",
          rubric: "",
        },
      },
    },
  ],
  createdAt: "",
  updatedAt: "",
};
function analytics(score: number, wrong: number): AnalyticsData {
  return {
    results: [],
    classrooms: [],
    knowledge: [{ tag: "知识点", earned: score, maximum: 5, accuracy: score / 5, attempts: 1 }],
    students: [
      {
        studentId: "student",
        subjects: [{ subject: "数学", earned: score, maximum: 5, accuracy: score / 5 }],
        knowledge: [{ tag: "知识点", earned: score, maximum: 5, accuracy: score / 5, attempts: 1 }],
        wrongQuestions: Array.from({ length: wrong }, (_, i) => ({
          assessmentId: "exam2",
          paperId: "paper",
          itemId: String(i),
          question: paper.items[0].snapshot,
          score: 0,
          maximum: 5,
          answer: { itemId: String(i), text: "", images: [] },
          feedback: "",
        })),
        recommendations: [],
      },
    ],
  };
}
const state = {
  actor: { id: "account", name: "学生", role: "STUDENT" },
  questions: [],
  papers: [paper],
  classrooms: [
    {
      id: "class",
      name: "班级",
      stage: "高中",
      cohort: "2027届",
      ownerId: "teacher",

      students: [
        {
          id: "student",
          name: "学生",
          studentNumber: "000001",
          classroomId: "class",
          userId: "account",
        },
      ],
    },
  ],
  assessments: [
    {
      id: "exam1",
      name: "考试一",
      kind: "EXAM",
      reviewScope: "CLASSROOM",
      classroomIds: ["class"],
      papers: [{ paperId: "paper", subject: "数学" }],
    },
    {
      id: "exam2",
      name: "考试二",
      kind: "EXAM",
      reviewScope: "CLASSROOM",
      classroomIds: ["class"],
      papers: [{ paperId: "paper", subject: "数学" }],
    },
  ],
  templates: [],
  submissions: [],
  reviews: [],
  users: [],
  analytics: analytics(5, 0),
} as unknown as PlatformState;
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function select(label: string, value: string) {
  const element = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
it("requests exam-scoped student analytics without reviews and updates subjects, knowledge and wrong counts together", async () => {
  vi.mocked(apiRequest).mockImplementation(
    async (url) =>
      analytics(
        String(url).includes("assessmentId=exam2") ? 0 : 5,
        String(url).includes("assessmentId=exam2") ? 1 : 0,
      ) as never,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Analytics, { state })),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await click("错题与练习");
  expect(container.textContent).toContain("5 / 5");
  expect(container.textContent).toContain("错题汇总 · 0 题");
  await select("筛选考试", "exam2");
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("assessmentId=exam2");
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("studentId=student");
  expect(container.textContent).toContain("0 / 5");
  expect(container.textContent).toContain("错题汇总 · 1 题");
  await click("知识点掌握");
  expect(container.textContent).toContain("0.0%");
  expect(container.textContent).toContain("0 / 5");
});
it("lets a keyboard user create the first workbook region with no pointer and edit valid page coordinates", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ imported: 1, issues: [] } as never);
  await act(async () =>
    root.render(
      createElement(Scans, {
        state: { ...state, actor: { id: "teacher", name: "教师", role: "TEACHER" } },
        refresh: async () => {},
        notify: () => {},
      }),
    ),
  );
  const controls = container.querySelectorAll("select");
  await act(async () => {
    controls[1].value = "paper";
    controls[1].dispatchEvent(new Event("change", { bubbles: true }));
    controls[2].value = "WORKBOOK";
    controls[2].dispatchEvent(new Event("change", { bubbles: true }));
  });
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(fileInput, "files", {
      value: [new File(["image"], "page.png", { type: "image/png" })],
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const add = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "添加第 1 题答题区域",
  )!;
  expect(add).toBeTruthy();
  await act(async () => {
    add.focus();
    add.click();
  });
  const details = Array.from(container.querySelectorAll("details")).find(
    (d) => d.querySelector("summary")?.textContent === "精确调整坐标",
  )!;
  expect(details.open).toBe(true);
  const inputs = details.querySelectorAll('input[type="number"]');
  expect(inputs).toHaveLength(5);
  expect((inputs[0] as HTMLInputElement).value).toBe("1");
  expect((inputs[0] as HTMLInputElement).max).toBe("1");
  expect((inputs[1] as HTMLInputElement).value).toBe("0.05");
  expect(add.disabled).toBe(true);
});

async function renderScanner(notify = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(Scans, {
        state: {
          ...state,
          actor: { id: "teacher", name: "教师", role: "TEACHER" },
          templates: [{ ...generateCardTemplate(paper), id: "template" }],
        },
        refresh: async () => {},
        notify,
      }),
    ),
  );
  return notify;
}
async function scannerChoice(label: string, value: string) {
  const field = Array.from(container.querySelectorAll("label")).find(
    (element) => element.querySelector("span")?.textContent === label,
  )!;
  const control = field.querySelector("select")!;
  await act(async () => {
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("captures an eSCL feeder batch with duplex and DPI settings and uploads PNG/JPEG pages in order", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        devices: [
          { id: "escl:offline", name: "离线设备", backend: "escl", unavailable: "offline" },
          { id: "escl:office", name: "办公室", backend: "escl" },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        pages: [
          { mime: "image/png", data: btoa("first page") },
          { mime: "image/jpeg", data: btoa("second page") },
        ],
      }),
    });
  vi.stubGlobal("fetch", fetcher);
  vi.mocked(apiRequest).mockResolvedValue({ imported: 1, issues: [] } as never);
  const notify = await renderScanner();
  await click("查找扫描仪");
  expect((container.querySelector('select[aria-label="扫描仪"]') as HTMLSelectElement).value).toBe(
    "escl:office",
  );
  expect(
    (container.querySelector('option[value="escl:offline"]') as HTMLOptionElement).disabled,
  ).toBe(true);
  await scannerChoice("纸张来源", "Feeder");
  await scannerChoice("进纸方式", "duplex");
  await scannerChoice("扫描分辨率", "200");
  await click("批量扫描并添加图像");
  expect(fetcher.mock.calls[1][0]).toBe("http://127.0.0.1:17863/scan-batch");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    deviceId: "escl:office",
    source: "Feeder",
    resolution: 200,
    duplex: true,
    maxPages: 100,
  });
  expect(notify).toHaveBeenLastCalledWith("扫描完成，2 页图像已按顺序加入待上传列表。");
  await scannerChoice("科目试卷", "paper");
  await scannerChoice("答题卡模板", "template");
  await click("上传并切题");
  const form = vi.mocked(apiRequest).mock.calls.at(-1)![1]!.body as FormData;
  const uploaded = form.getAll("files") as File[];
  expect(uploaded).toHaveLength(2);
  expect(uploaded.map((file) => file.type)).toEqual(["image/png", "image/jpeg"]);
  expect(uploaded[0].name).toMatch(/-1\.png$/);
  expect(uploaded[1].name).toMatch(/-2\.jpg$/);
});
it("keeps existing scanned files when a later feeder batch is empty or the bridge reports an error", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ devices: [{ id: "escl:office", name: "办公室", backend: "escl" }] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["single page"], { type: "image/jpeg" }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ pages: [] }) })
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "进纸器卡纸，请清理后重试" }),
    });
  vi.stubGlobal("fetch", fetcher);
  const notify = await renderScanner();
  await click("查找扫描仪");
  await click("扫描并添加图像");
  expect(fetcher.mock.calls[1][0]).toBe("http://127.0.0.1:17863/scan");
  expect(container.querySelectorAll(".p-list-row")).toHaveLength(1);
  expect(container.textContent).toMatch(/-1\.jpg/);
  await scannerChoice("纸张来源", "Feeder");
  await click("批量扫描并添加图像");
  expect(notify).toHaveBeenLastCalledWith("扫描仪返回的页数无效，请检查进纸器后重试。", true);
  expect(container.querySelectorAll(".p-list-row")).toHaveLength(1);
  await click("批量扫描并添加图像");
  expect(notify).toHaveBeenLastCalledWith("进纸器卡纸，请清理后重试", true);
  expect(container.querySelectorAll(".p-list-row")).toHaveLength(1);
});
it("does not offer capture when every discovered scanner is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        devices: [
          {
            id: "escl:offline",
            name: "离线设备",
            backend: "escl",
            unavailable: "Connection refused",
          },
        ],
      }),
    }),
  );
  const notify = await renderScanner();
  await click("查找扫描仪");
  expect((container.querySelector('select[aria-label="扫描仪"]') as HTMLSelectElement).value).toBe(
    "",
  );
  expect(
    Array.from(container.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("扫描并添加图像"),
    ),
  ).toBe(false);
  expect(notify).toHaveBeenLastCalledWith("未发现可用扫描仪，请检查设备连接与桥接配置。", true);
});
