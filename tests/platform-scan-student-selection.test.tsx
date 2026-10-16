// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { Scans } from "@/components/platform/scans";
import { apiRequest } from "@/lib/http-client";

vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({ useOptionalDomain: () => null }));
vi.mock("@/components/platform/workbook-crop", () => ({ WorkbookCrop: () => null }));

function fixture(): PlatformState {
  return {
    actor: { id: "teacher", name: "教师", role: "ADMIN" },
    assessments: [
      {
        id: "exam",
        name: "多科考试",
        rosterRevision: 1,
        rosterStatus: "CONFIRMED",
        papers: [
          { paperId: "math", subject: "数学" },
          { paperId: "english", subject: "英语" },
        ],
        participants: [
          {
            id: "pa",
            studentId: "a",
            name: "甲",
            studentNumber: "01",
            subjects: [
              { paperId: "math", status: "REQUIRED" },
              { paperId: "english", status: "EXEMPT" },
            ],
          },
          {
            id: "pb",
            studentId: "b",
            name: "乙",
            studentNumber: "02",
            subjects: [
              { paperId: "math", status: "REQUIRED" },
              { paperId: "english", status: "REQUIRED" },
            ],
          },
        ],
      },
    ],
    papers: [
      { id: "math", name: "数学卷", items: [] },
      { id: "english", name: "英语卷", items: [] },
    ],
    templates: [],
    submissions: [],
    classrooms: [],
  } as unknown as PlatformState;
}
let container: HTMLDivElement, root: Root;
const notify = vi.fn(),
  refresh = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.mocked(apiRequest).mockResolvedValue({ imported: 1, issues: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(state = fixture(), fixedKind: "CARD" | "WORKBOOK" = "CARD") {
  await act(async () =>
    root.render(createElement(Scans, { state, fixedKind, section: "upload", notify, refresh })),
  );
}
function studentSelect() {
  return [...container.querySelectorAll<HTMLSelectElement>("select")].at(-1)!;
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function files() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["scan"], "乙.png", { type: "image/png" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it("clears a manual card override on paper change and sends automatic recognition without the hidden student", async () => {
  await render();
  const paper = container.querySelectorAll<HTMLSelectElement>("select")[1];
  await choose(paper, "math");
  await choose(studentSelect(), "a");
  await files();
  await choose(paper, "english");
  expect(studentSelect().value).toBe("");
  expect([...studentSelect().options].map((option) => option.value)).toEqual(["", "b"]);
  expect(container.textContent).toContain("乙.png");
  await submit();
  const form = vi.mocked(apiRequest).mock.calls[0][1]?.body as FormData;
  expect(form.get("paperId")).toBe("english");
  expect(form.get("studentId")).toBeNull();
});

it("does not choose another workbook student and blocks submission until explicitly selected", async () => {
  await render(fixture(), "WORKBOOK");
  const paper = container.querySelectorAll<HTMLSelectElement>("select")[1];
  await choose(paper, "math");
  await choose(studentSelect(), "a");
  await files();
  await choose(paper, "english");
  expect(studentSelect().value).toBe("");
  await submit();
  expect(apiRequest).not.toHaveBeenCalled();
  expect(notify).toHaveBeenLastCalledWith("请从当前科目的应考名单中选择对应学生。", true);
  expect(container.textContent).toContain("乙.png");
  await choose(studentSelect(), "b");
  await submit();
  expect((vi.mocked(apiRequest).mock.calls[0][1]?.body as FormData).get("studentId")).toBe("b");
});

it("removes an invalid selection on roster refresh without restoring it when participation later returns", async () => {
  const state = fixture();
  await render(state);
  await choose(container.querySelectorAll<HTMLSelectElement>("select")[1], "math");
  await choose(studentSelect(), "a");
  await files();
  const changed = fixture();
  changed.assessments[0].rosterRevision++;
  changed.assessments[0].participants[0].subjects[0].status = "WITHDRAWN";
  await render(changed);
  expect(studentSelect().value).toBe("");
  await render(state);
  expect(studentSelect().value).toBe("");
  await submit();
  expect((vi.mocked(apiRequest).mock.calls[0][1]?.body as FormData).get("studentId")).toBeNull();
});

it("retains an explicitly chosen eligible student across ordinary refreshes", async () => {
  await render();
  await choose(container.querySelectorAll<HTMLSelectElement>("select")[1], "math");
  await choose(studentSelect(), "a");
  await render();
  expect(studentSelect().value).toBe("a");
  await files();
  await submit();
  expect((vi.mocked(apiRequest).mock.calls[0][1]?.body as FormData).get("studentId")).toBe("a");
});
