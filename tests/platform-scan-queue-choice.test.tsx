// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { Scans } from "@/components/platform/scans";

vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({ useOptionalDomain: () => null }));
vi.mock("next/image", () => ({ default: () => null }));

const state = {
  actor: { id: "teacher", name: "教师", role: "ADMIN" },
  assessments: [
    {
      id: "exam",
      name: "期中考试",
      classroomIds: [],
      papers: [{ paperId: "paper", subject: "数学" }],
      rosterStatus: "CONFIRMED",
      rosterRevision: 1,
      participants: [
        {
          id: "pa",
          studentId: "a",
          name: "甲",
          studentNumber: "01",
          subjects: [{ paperId: "paper", status: "REQUIRED" }],
        },
      ],
    },
  ],
  papers: [{ id: "paper", name: "数学卷", items: [{ id: "item" }] }],
  templates: [],
  submissions: [],
  classrooms: [],
} as unknown as PlatformState;
let container: HTMLDivElement, root: Root;
const notify = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function renderWorkbook() {
  await act(async () =>
    root.render(
      createElement(Scans, {
        state,
        fixedKind: "WORKBOOK",
        section: "upload",
        notify,
        refresh: vi.fn(),
      }),
    ),
  );
  await choose(container.querySelectorAll<HTMLSelectElement>("select")[1], "paper");
}
async function selectFiles(names: string[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: names.map((name) => new File(["scan"], name, { type: "image/png" })),
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function queueRows() {
  return [...container.querySelectorAll(".p-list-row span")].map(
    (span) => span.firstChild?.textContent,
  );
}
function addRegion() {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("添加第 1 题答题区域"),
  )!;
  return act(async () => button.click());
}
function regionCount() {
  const field = Array.from(container.querySelectorAll("label")).find((label) =>
    label.textContent?.includes("当前框选题目"),
  )!;
  return Number(field.querySelector("option")!.textContent?.match(/（(\d+) 个区域）/)?.[1]);
}

it("loads selected pages straight into an empty queue without asking", async () => {
  await renderWorkbook();
  await selectFiles(["A.png"]);
  expect(window.confirm).not.toHaveBeenCalled();
  expect(queueRows()).toEqual(["A.png"]);
  expect(notify).toHaveBeenLastCalledWith("已载入 1 页扫描材料。");
});

it("appends newly selected pages and keeps crop regions when replacement is declined", async () => {
  await renderWorkbook();
  await selectFiles(["A.png"]);
  await addRegion();
  expect(regionCount()).toBe(1);
  await selectFiles(["B.png"]);
  expect(window.confirm).toHaveBeenCalledTimes(1);
  const asked = vi.mocked(window.confirm).mock.calls[0][0];
  expect(asked).toContain("待上传列表已有 1 页扫描材料");
  expect(asked).toContain("取消");
  expect(asked).toContain("追加");
  expect(queueRows()).toEqual(["A.png", "B.png"]);
  expect(regionCount()).toBe(1);
  expect(notify).toHaveBeenLastCalledWith("已追加 1 页扫描材料，待上传列表现有 2 页。");
});

it("replaces the queue and clears crop regions only after explicit confirmation", async () => {
  await renderWorkbook();
  await selectFiles(["A.png"]);
  await addRegion();
  vi.mocked(window.confirm).mockReturnValue(true);
  await selectFiles(["B.png", "C.png"]);
  expect(window.confirm).toHaveBeenCalledTimes(1);
  const asked = vi.mocked(window.confirm).mock.calls[0][0];
  expect(asked).toContain("仅保留新选的 2 页");
  expect(asked).toContain("已框选的作答区域会一并清除");
  expect(queueRows()).toEqual(["B.png", "C.png"]);
  expect(regionCount()).toBe(0);
  expect(notify).toHaveBeenLastCalledWith("已替换待上传列表，现有 2 页扫描材料。");
});
