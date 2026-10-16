// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RosterHistory } from "@/contracts/assessment-roster-history";
import type { PlatformState } from "@/contracts/platform";
import { AssessmentRosterHistory } from "@/components/platform/assessment-roster-history";
import { AssessmentRosterPage } from "@/components/platform/assessment-pages";
import { apiRequest } from "@/lib/http-client";
const api = vi.mocked(apiRequest);
let state: PlatformState;
vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state, area: "exams" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const history = (): RosterHistory => ({
  assessmentId: "exam",
  currentRevision: 3,
  scopeRestricted: false,
  nextBeforeRevision: null,
  events: [
    {
      id: "event",
      revision: 3,
      createdAt: "2026-10-15T08:00:00Z",
      actorName: "操作教师",
      reason: "按请假记录核对",
      confirmedReconstruction: false,
      reconstructedCandidate: false,
      entries: [
        {
          studentId: "student",
          name: "名单时姓名",
          studentNumber: "1001",
          classroomId: "class",
          classroomName: "名单时班级",
          paperId: "paper",
          subject: "数学",
          beforeStatus: "REQUIRED",
          status: "ABSENT",
          reason: "病假",
          kind: "STATUS_CHANGED",
        },
      ],
    },
  ],
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.mockReset();
  state = { actor: { id: "student-account", role: "STUDENT", name: "学生" } } as PlatformState;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<AssessmentRosterHistory assessmentId="exam" />));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("reads on demand and explains who changed a saved member's subject status, when and why", async () => {
  api.mockResolvedValue(history());
  await render();
  expect(api).not.toHaveBeenCalled();
  await click("读取变更历史");
  expect(api).toHaveBeenCalledExactlyOnceWith("/api/platform/roster-history?assessmentId=exam");
  expect(container.textContent).toContain("操作教师");
  expect(container.querySelector("time")?.dateTime).toBe("2026-10-15T08:00:00Z");
  expect(container.textContent).toContain("名单时姓名");
  expect(container.textContent).toContain("应考 → 缺考");
  expect(container.textContent).toContain("病假");
  expect(
    container.querySelector('[aria-label="版本 3 逐项名单变更"]')?.getAttribute("tabindex"),
  ).toBe("0");
  expect(container.querySelector("form,input,textarea,select")).toBeNull();
});
it("keeps the read-only record after failed refresh and offers a working retry", async () => {
  api.mockResolvedValueOnce(history());
  await render();
  await click("读取变更历史");
  api.mockRejectedValueOnce(new Error("网络中断"));
  await click("重新读取历史");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("网络中断");
  expect(container.textContent).toContain("名单时姓名");
  api.mockResolvedValueOnce({ ...history(), events: [] });
  await click("重新读取历史");
  expect(container.textContent).toContain("当前查询范围没有可显示的变更记录");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("paginates a restricted empty page and refuses to merge pages from a changed roster version", async () => {
  api.mockResolvedValueOnce({
    ...history(),
    scopeRestricted: true,
    events: [],
    nextBeforeRevision: 3,
  });
  await render();
  await click("读取变更历史");
  expect(container.textContent).toContain("其他范围及整体调整原因不展示");
  api.mockResolvedValueOnce({ ...history(), currentRevision: 4 });
  await click("读取更早记录");
  expect(api.mock.lastCall?.[0]).toContain("beforeRevision=3");
  expect(container.textContent).toContain("名单已有新变更");
  expect(container.textContent).not.toContain("名单时姓名");
});
it("appends earlier records only when the current roster revision still matches", async () => {
  api.mockResolvedValueOnce({ ...history(), nextBeforeRevision: 3 });
  await render();
  await click("读取变更历史");
  api.mockResolvedValueOnce({
    ...history(),
    events: [
      {
        ...history().events[0],
        id: "old",
        revision: 2,
        confirmedReconstruction: true,
        entries: [],
      },
    ],
  });
  await click("读取更早记录");
  expect(container.textContent).toContain("名单版本 3");
  expect(container.textContent).toContain("名单版本 2");
  expect(container.textContent).toContain("明确核对并确认重建名单");
  expect(container.textContent).not.toContain("读取更早记录");
});
it("never renders a roster or history entry for a student even with a retained assessment in client state", async () => {
  state.assessments = [
    { id: "exam", participants: [{ name: "不可显示的名单" }] },
  ] as PlatformState["assessments"];
  await act(async () => root.render(<AssessmentRosterPage id="exam" />));
  expect(container.textContent).not.toContain("不可显示的名单");
  expect(container.textContent).not.toContain("名单变更历史");
  expect(api).not.toHaveBeenCalled();
});

it("explains a real migration reconstruction as a candidate requiring review, with the system operator", async () => {
  const payload = history();
  payload.events = [
    {
      ...payload.events[0],
      actorName: "系统迁移",
      reconstructedCandidate: true,
      confirmedReconstruction: false,
      entries: [],
      reason: "原系统未保存参试名册，按迁移时班级名单与已有答卷重建，须人工核对。",
    },
  ];
  api.mockResolvedValueOnce(payload);
  await render();
  await click("读取变更历史");
  expect(container.textContent).toContain("系统迁移");
  expect(container.textContent).toContain("不是原始实际参试名单的确认记录");
  expect(container.textContent).not.toContain("已明确核对并确认重建名单");
});
