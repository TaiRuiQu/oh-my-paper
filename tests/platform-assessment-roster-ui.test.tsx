// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Assessment, PlatformState } from "@/contracts/platform";
import { AssessmentRoster } from "@/components/platform/assessment-roster";
import { AssessmentEditor } from "@/components/platform/assessments";
import { AssessmentOverviewPage } from "@/components/platform/assessment-pages";
const domain = vi.hoisted(() => ({
  state: {} as PlatformState,
  mutate: vi.fn(),
  refresh: vi.fn(),
  pending: false,
}));
vi.mock("@/components/platform/domain-provider", () => ({ useDomain: () => domain }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
function assessment(): Assessment {
  return {
    id: "exam",
    ownerId: "teacher",
    name: "考试",
    kind: "EXAM",
    reviewScope: "CLASSROOM",
    classroomIds: ["class"],
    published: false,
    createdAt: "",
    canManage: true,
    rosterRevision: 3,
    rosterStatus: "CONFIRMED",
    papers: [
      {
        paperId: "paper",
        subject: "数学",
        gradingMode: "SINGLE",
        arbitrationThreshold: 2,
        conversion: { enabled: false, bands: [] },
      },
    ],
    participants: [
      {
        id: "participant",
        studentId: "student",
        name: "张同学",
        studentNumber: "1001",
        classroomId: "class",
        classroomName: "一班（保存时）",
        stage: "高中",
        cohort: "2027",
        subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
      },
    ],
  };
}
let container: HTMLDivElement, root: Root, exam: Assessment;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  exam = assessment();
  domain.state = {
    actor: { id: "teacher", role: "TEACHER", name: "教师" },
    classrooms: [
      {
        id: "class",
        ownerId: "teacher",
        name: "当前班名",
        stage: "高中",
        cohort: "2027",
        students: [
          {
            id: "new-student",
            classroomId: "class",
            name: "新同学",
            studentNumber: "1002",
            userId: null,
          },
        ],
      },
    ],
  } as PlatformState;
  Object.assign(domain.state, {
    assessments: [exam],
    submissions: [],
    reviews: [],
    questions: [],
    templates: [],
    users: [],
    analytics: { results: [], students: [], knowledge: [], classrooms: [] },
    papers: exam.papers.map((p) => ({
      ...p,
      id: p.paperId,
      name: "数学试卷",
      kind: "EXAM",
      items: [],
    })),
  });
  domain.mutate.mockReset().mockResolvedValue({ id: "exam" });
  domain.refresh.mockReset().mockResolvedValue(undefined);
  domain.pending = false;
  vi.spyOn(window, "confirm").mockReturnValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<AssessmentRoster assessment={exam} root="/exams" />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function input(selector: string, value: string) {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector,
  )!;
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
async function prepare() {
  await click("调整参与名单");
  await input("select", "ABSENT");
  await input('input[placeholder="本项调整原因"]', "病假");
  await input("textarea", "核对缺考登记");
}
it("renders saved identity and never silently adds current classroom members", async () => {
  await render();
  expect(container.textContent).toContain("一班（保存时）");
  expect(container.textContent).not.toContain("新同学");
  await click("调整参与名单");
  expect(container.textContent).toContain("新同学");
  expect(domain.mutate).not.toHaveBeenCalled();
});
it("previews exact reasons before saving a revision-checked update", async () => {
  await render();
  await prepare();
  await click("预览调整影响");
  expect(domain.mutate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("张同学 · 数学 → 缺考：病假");
  await click("确认并保存名单");
  expect(domain.mutate).toHaveBeenCalledExactlyOnceWith({
    type: "assessment.roster.update",
    id: "exam",
    expectedRevision: 3,
    reason: "核对缺考登记",
    addStudentIds: [],
    changes: [{ participantId: "participant", paperId: "paper", status: "ABSENT", reason: "病假" }],
    confirmReconstruction: false,
  });
});
it("retains a draft and blocks stale submission after another session updates the roster", async () => {
  await render();
  await prepare();
  exam = { ...exam, rosterRevision: 4 };
  await render();
  expect(container.querySelector("textarea")!.value).toBe("核对缺考登记");
  expect(container.textContent).toContain("你的调整仍保留");
  expect(
    [...container.querySelectorAll("button")].find((b) => b.textContent === "预览调整影响")!
      .disabled,
  ).toBe(true);
  expect(domain.mutate).not.toHaveBeenCalled();
  await click("取消调整");
  expect(window.confirm).toHaveBeenCalled();
  expect(container.querySelector("textarea")).not.toBeNull();
});
it("preserves preview and draft after a failed save", async () => {
  domain.mutate.mockResolvedValue({ error: "版本冲突" });
  await render();
  await prepare();
  await click("预览调整影响");
  await click("确认并保存名单");
  expect(container.textContent).toContain("版本冲突");
  await click("返回修改");
  expect(container.querySelector("textarea")!.value).toBe("核对缺考登记");
});
it("requires explicit confirmation of reconstructed historical rosters", async () => {
  exam.rosterStatus = "NEEDS_REVIEW";
  await render();
  await click("调整参与名单");
  await input("textarea", "核对原始记录");
  await click("预览调整影响");
  expect(container.textContent).toContain("请核对后确认重建名单");
  expect(domain.mutate).not.toHaveBeenCalled();
});
it("does not offer editing for a nonowner or a published assessment", async () => {
  domain.state.actor.id = "other";
  exam.canManage = false;
  await render();
  expect(container.textContent).toContain("调整请联系");
  expect(container.querySelector("button")).toBeNull();
  domain.state.actor.id = "teacher";
  exam.canManage = true;
  exam.published = true;
  await render();
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector('a[href="/exams/exam/publish"]')).toBeTruthy();
});

async function renderEditor() {
  await act(async () =>
    root.render(
      <AssessmentEditor
        assessment={exam}
        state={domain.state}
        mutate={domain.mutate}
        pending={false}
        close={vi.fn()}
      />,
    ),
  );
}
it("locks settings for nonowners and published arrangements even when there are no submissions", async () => {
  domain.state.actor.id = "other";
  exam.canManage = false;
  await renderEditor();
  expect(container.querySelector('input[name="name"]')?.matches(":disabled")).toBe(true);
  expect(container.textContent).not.toContain("保存安排");
  domain.state.actor.id = "teacher";
  exam.canManage = true;
  exam.published = true;
  await renderEditor();
  expect(container.querySelector('input[name="name"]')?.matches(":disabled")).toBe(true);
  expect(container.textContent).not.toContain("保存安排");
});
it("keeps the controlled name when a disabled confirmation preview is submitted", async () => {
  exam.classroomIds = ["old-class"];
  await renderEditor();
  const checkbox = container.querySelector<HTMLInputElement>('input[name="classroomIds"]')!;
  await act(async () => checkbox.click());
  const student = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (el) => el.closest("label")?.textContent?.includes("新同学"),
  )!;
  await act(async () => student.click());
  await input("textarea", "调整参与班级");
  await click("预览名单变化");
  expect(domain.mutate).not.toHaveBeenCalled();
  expect(container.querySelector('input[name="name"]')?.matches(":disabled")).toBe(true);
  await click("确认并保存安排");
  expect(domain.mutate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      assessment: expect.objectContaining({
        name: "考试",
        expectedRosterRevision: 3,
        rosterStudentIds: ["new-student"],
        rosterChangeReason: "调整参与班级",
      }),
    }),
  );
});
it("counts required submissions separately from retained nonparticipating records", async () => {
  const absent = structuredClone(exam.participants[0]);
  absent.id = "absent-participant";
  absent.studentId = "absent";
  absent.subjects[0].status = "ABSENT";
  absent.subjects[0].reason = "病假";
  exam.participants.push(absent);
  domain.state.submissions = ["student", "absent"].map((studentId) => ({
    id: studentId,
    assessmentId: "exam",
    paperId: "paper",
    studentId,
    status: "GRADED",
  })) as PlatformState["submissions"];
  await act(async () => root.render(<AssessmentOverviewPage id="exam" />));
  expect(container.textContent).toContain("1 / 1 份");
  expect(container.textContent).toContain("另保留 1 份非应考答卷");
});

function expectDraftGuard() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}
it("recovers an error-only roster conflict through explicit refresh, retaining drafts on decline and read failure", async () => {
  domain.mutate.mockResolvedValue({ error: "名单版本冲突，请重新读取" });
  await render();
  await prepare();
  await click("预览调整影响");
  await click("确认并保存名单");
  expect(exam.rosterRevision).toBe(3);
  await click("重新读取名单");
  expect(domain.refresh).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("核对缺考登记");
  vi.mocked(window.confirm).mockReturnValue(true);
  domain.refresh.mockRejectedValueOnce(new Error("网络中断，请重试"));
  await click("重新读取名单");
  expect(container.textContent).toContain("网络中断，请重试");
  expect(container.querySelector("textarea")!.value).toBe("核对缺考登记");
  expectDraftGuard();
  domain.refresh.mockImplementationOnce(async () => {
    exam = { ...exam, rosterRevision: 4 };
    domain.state.assessments = [exam];
    await render();
  });
  await click("重新读取名单");
  expect(container.textContent).toContain("名单版本 4");
  expect(container.querySelector("textarea")).toBeNull();
  expect(domain.mutate).toHaveBeenCalledTimes(1);
  domain.mutate.mockResolvedValue({ id: "exam" });
  await prepare();
  await click("预览调整影响");
  await click("确认并保存名单");
  expect(domain.mutate.mock.lastCall?.[0]).toMatchObject({ expectedRevision: 4 });
});
async function prepareScopeChange() {
  const checkbox = container.querySelector<HTMLInputElement>('input[name="classroomIds"]')!;
  await act(async () => checkbox.click());
  const student = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (el) => el.closest("label")?.textContent?.includes("新同学"),
  )!;
  await act(async () => student.click());
  await input("textarea", "调整参与班级");
  await click("预览名单变化");
}
it("reloads an error-only settings scope conflict without replaying the draft and uses the latest revision on a new edit", async () => {
  exam.classroomIds = ["old-class"];
  domain.mutate.mockResolvedValue({ error: "参与名单版本已变化" });
  await renderEditor();
  await prepareScopeChange();
  await click("确认并保存安排");
  expect(container.textContent).toContain("参与名单版本已变化");
  await click("重新读取名单");
  expect(domain.refresh).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  domain.refresh.mockRejectedValueOnce(new Error("读取失败"));
  await click("重新读取名单");
  expect(container.querySelector("textarea")!.value).toBe("调整参与班级");
  expectDraftGuard();
  domain.refresh.mockImplementationOnce(async () => {
    exam = { ...exam, name: "最新安排", rosterRevision: 4 };
    domain.state.assessments = [exam];
    await renderEditor();
  });
  await click("重新读取名单");
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("最新安排");
  expect(container.querySelector("textarea")).toBeNull();
  expect(domain.mutate).toHaveBeenCalledTimes(1);
  domain.mutate.mockResolvedValue({ id: "exam" });
  await prepareScopeChange();
  await click("确认并保存安排");
  expect(domain.mutate.mock.lastCall?.[0]).toMatchObject({
    assessment: { expectedRosterRevision: 4, name: "最新安排" },
  });
});
it("does not label a previously withdrawn member as newly removed in the settings preview", async () => {
  exam.classroomIds = ["old-class"];
  exam.participants[0].subjects[0] = { paperId: "paper", status: "WITHDRAWN", reason: "早已退出" };
  await renderEditor();
  await prepareScopeChange();
  const preview = container.querySelector('[role="status"]')!;
  expect(preview.textContent).toContain("移除：无");
  expect(preview.textContent).not.toContain("移除：张同学");
});
