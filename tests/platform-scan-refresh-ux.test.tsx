// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { Scans } from "@/components/platform/scans";

vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({ useOptionalDomain: () => null }));
vi.mock("@/components/platform/workbook-crop", () => ({ WorkbookCrop: () => null }));

const state = {
  actor: { id: "teacher", name: "教师", role: "ADMIN" },
  assessments: [
    {
      id: "exam",
      name: "期中考试",
      classroomIds: [],
      papers: [],
      participants: [],
      rosterStatus: "CONFIRMED",
      rosterRevision: 1,
    },
  ],
  classrooms: [],
  papers: [],
  templates: [],
  submissions: [],
} as unknown as PlatformState;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(refresh: () => Promise<void>, notify = vi.fn(), names = ["学生扫描.png"]) {
  await act(async () => {
    root.render(createElement(Scans, { state, refresh, notify, section: "upload" }));
  });
  await selectFiles(names);
  return notify;
}
async function selectFiles(names: string[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: names.map((name) => new File(["scan"], name, { type: "image/png" })),
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
function retryButton() {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("刷新记录"),
  )!;
}

it("preserves a committed import when refreshing fails and retries only the read", async () => {
  let resolveImport!: (value: { imported: number; issues: [] }) => void;
  vi.mocked(apiRequest).mockImplementationOnce(
    () => new Promise((resolve) => (resolveImport = resolve)),
  );
  const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
  const notify = await render(refresh);
  await act(async () => {
    submit();
    submit();
  });
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await act(async () => resolveImport({ imported: 2, issues: [] }));
  expect(container.textContent).toContain("本批已导入 2 份答卷");
  expect(container.textContent).toContain("列表暂未更新");
  expect(container.textContent).not.toContain("学生扫描.png");
  expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("成功导入 2 份答卷"), false);
  await act(async () => {
    retryButton().click();
    retryButton().click();
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("本批已导入 2 份答卷");
  expect(container.textContent).toContain("答卷记录已更新");
  expect(retryButton()).toBeUndefined();
});

it("consumes both files after a partial import and never re-uploads them after refresh recovers", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({
    imported: 1,
    issues: [{ file: "B.png", error: "学号无法匹配", sourceUrl: "/api/platform/assets/B" }],
  });
  const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
  await render(refresh, vi.fn(), ["A.png", "B.png"]);
  await act(async () => submit());
  expect(container.textContent).toContain("本批已导入 1 份答卷");
  expect(container.textContent).toContain("学号无法匹配");
  expect(container.textContent).not.toContain("A.png");
  expect(container.querySelectorAll(".p-list-row")).toHaveLength(0);
  expect(container.querySelector('a[href="/api/platform/assets/B"]')).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => {
    submit();
    retryButton().click();
  });
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("本批已导入 1 份答卷");
  expect(container.textContent).toContain("学号无法匹配");
  expect(container.textContent).toContain("答卷记录已更新");
  await act(async () => submit());
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

it("clears every page of a partial batch and accepts only the newly selected complete student group", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({
      imported: 1,
      issues: [{ file: "B-2.png", error: "页面定位失败", sourceUrl: "/api/platform/assets/B2" }],
    })
    .mockResolvedValueOnce({ imported: 1, issues: [] });
  const refresh = vi.fn().mockResolvedValue(null);
  await render(refresh, vi.fn(), ["A-1.png", "A-2.png", "B-1.png", "B-2.png"]);
  await act(async () => submit());
  expect(container.querySelectorAll(".p-list-row")).toHaveLength(0);
  expect(container.textContent).toContain("失败学生的全部页面");
  expect(container.textContent).toContain("完整页组");
  expect(container.querySelector('a[href="/api/platform/assets/B2"]')).not.toBeNull();
  await act(async () => submit());
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await selectFiles(["B-1.png", "B-2.png"]);
  await act(async () => submit());
  expect(apiRequest).toHaveBeenCalledTimes(2);
  const uploaded = vi.mocked(apiRequest).mock.calls[1][1]?.body as FormData;
  expect(uploaded.getAll("files").map((file) => (file as File).name)).toEqual([
    "B-1.png",
    "B-2.png",
  ]);
});

it("keeps files available for a genuine upload failure and releases the submission lock", async () => {
  vi.mocked(apiRequest)
    .mockRejectedValueOnce(new Error("上传连接中断"))
    .mockResolvedValueOnce({ imported: 1, issues: [] });
  const refresh = vi.fn().mockResolvedValue(null);
  const notify = await render(refresh);
  await act(async () => submit());
  expect(notify).toHaveBeenLastCalledWith("上传连接中断", true);
  expect(container.textContent).toContain("学生扫描.png");
  expect(container.textContent).not.toContain("本批已导入");
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => submit());
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("本批已导入 1 份答卷");
});

it.each([
  ["EXAM", "/exams/exam/publish"],
  ["HOMEWORK", "/homework/assignments/exam/publish"],
] as const)(
  "blocks preparing and submitting scans for published %s results",
  async (kind, href) => {
    const refresh = vi.fn();
    const notify = await render(refresh);
    await act(async () => {
      root.render(
        createElement(Scans, {
          state: {
            ...state,
            assessments: [{ ...state.assessments[0], kind, published: true }],
          },
          refresh,
          notify,
          section: "upload",
        }),
      );
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("成绩已发布");
    expect(container.querySelector<HTMLAnchorElement>("a.button")?.getAttribute("href")).toBe(href);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
    await act(async () => submit());
    expect(apiRequest).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Withdrawing publication restores the existing upload queue.
    await act(async () => {
      root.render(createElement(Scans, { state, refresh, notify, section: "upload" }));
    });
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      false,
    );
  },
);
it.each([
  ["TEACHER", "teacher", true],
  ["TEACHER", "subject-teacher", false],
  ["ADMIN", "admin", true],
] as const)(
  "offers a publication recovery action only to authorized %s %s",
  async (role, id, allowed) => {
    const refresh = vi.fn();
    await act(async () =>
      root.render(
        createElement(Scans, {
          state: {
            ...state,
            actor: { id, role, name: "教师" },
            assessments: [
              { ...state.assessments[0], ownerId: "teacher", published: true, kind: "EXAM" },
            ],
          },
          refresh,
          notify: vi.fn(),
          section: "upload",
        }),
      ),
    );
    expect(Boolean(container.querySelector('a[href="/exams/exam/publish"]'))).toBe(allowed);
    if (!allowed)
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "联系安排创建者或管理员",
      );
  },
);
it("allows switching from a published exam to an open exam without discarding selected pages", async () => {
  const refresh = vi.fn();
  const notify = await render(refresh);
  await act(async () =>
    root.render(
      createElement(Scans, {
        state: {
          ...state,
          assessments: [
            { ...state.assessments[0], kind: "EXAM", published: true },
            { ...state.assessments[0], id: "open-exam", kind: "EXAM", published: false },
          ],
        },
        refresh,
        notify,
        section: "upload",
      }),
    ),
  );
  const selector = container.querySelector<HTMLSelectElement>("select")!;
  expect(selector.disabled).toBe(false);
  await act(async () => {
    selector.value = "open-exam";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(container.textContent).toContain("学生扫描.png");
  expect(container.textContent).not.toContain("成绩已发布，无法再录入作答");
});
