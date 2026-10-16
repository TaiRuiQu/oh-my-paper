// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SchoolCommand, SchoolState, SchoolTimetableCheck } from "@/contracts/school";
import { SchoolWorkspace, type SchoolSection } from "@/components/school/workspace";
import { schoolToday } from "@/components/school/schedule";
import { SchoolScheduleView } from "@/components/school/schedule";
import { apiRequest, ApiRequestError } from "@/lib/http-client";

vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: vi.fn(),
}));
let state: SchoolState, container: HTMLDivElement, root: Root;
const api = vi.mocked(apiRequest);
function fixture(): SchoolState {
  return {
    actor: { id: "admin", name: "教务员", role: "ADMIN" },
    canManage: true,
    years: [
      { id: "year", version: 1, name: "2026 学年", startDate: "2026-09-01", endDate: "2027-08-31" },
    ],
    terms: [
      {
        id: "term",
        yearId: "year",
        name: "秋季学期",
        startDate: "2026-09-01",
        endDate: "2027-01-31",
        weekOneMonday: "2026-08-31",
        timezone: "Asia/Shanghai",
        archived: false,
        revision: 2,
        publishedRevision: 1,
        publishedAt: "2026-09-01T00:00:00Z",
        timetable: {
          periods: [{ id: "p1", name: "第一节", startTime: "08:00", endTime: "08:45" }],
          slots: [
            {
              id: "slot",
              offeringId: "offering",
              weekday: 1,
              periodIds: ["p1"],
              roomId: "room",
              fromWeek: 1,
              toWeek: 20,
              parity: "ALL",
            },
          ],
          calendar: [],
          overrides: [],
        },
      },
    ],
    courses: [{ id: "course", version: 3, name: "数学", subject: "数学", active: true }],
    rooms: [{ id: "room", version: 4, name: "教学楼101", capacity: 40, active: true }],
    offerings: [
      {
        id: "offering",
        termId: "term",
        courseId: "course",
        classroomId: "class",
        teacherId: "teacher",
        weeklyPeriods: 1,
        active: true,
      },
    ],
    classrooms: [{ id: "class", name: "一班", stage: "高中", cohort: "2027届" }],
    teachers: [{ id: "teacher", name: "张老师" }],
    publications: [],
  };
}
const preview = (): SchoolTimetableCheck => ({
  revision: 2,
  lessons: [],
  conflicts: [],
  warnings: [],
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state = fixture();
  api.mockImplementation(async (url) => {
    if (url === "/api/platform/school/state") return state as never;
    if (url.startsWith("/api/platform/school/timetable/check")) return preview() as never;
    if (url.startsWith("/api/platform/school/schedule"))
      return {
        termId: "term",
        revision: 1,
        timezone: "Asia/Shanghai",
        startDate: "2026-10-15",
        endDate: "2026-10-15",
        status: "PUBLISHED",
        lessons: [],
      } as never;
    return { id: "new" } as never;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(section: SchoolSection, initialState = state) {
  await act(async () =>
    root.render(<SchoolWorkspace initialState={initialState} section={section} />),
  );
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === text,
  );
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector,
  )!;
  expect(input, selector).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
function field(label: string) {
  const node = [...container.querySelectorAll("label")].find(
    (entry) => entry.querySelector("span")?.textContent === label,
  );
  expect(node, label).toBeTruthy();
  const input = node!.querySelector("input,select,textarea")!;
  if (!input.id) input.id = `test-${Math.random().toString().slice(2)}`;
  return `#${input.id}`;
}
function commands() {
  return api.mock.calls
    .filter(([url]) => url === "/api/platform/school/commands")
    .map(([, init]) => JSON.parse(String(init?.body)) as SchoolCommand);
}

it("uses the school timezone when the browser date is on another day", () => {
  expect(schoolToday("Asia/Shanghai", new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-15");
  expect(schoolToday("America/Los_Angeles", new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-14");
});
it.each(["settings", "timetable"] as const)(
  "keeps %s management and whole school directories hidden from students",
  async (section) => {
    state.canManage = false;
    state.actor.role = "STUDENT";
    await render(section);
    expect(container.textContent).not.toContain("教学楼101");
    expect(container.textContent).not.toContain("张老师");
    expect(container.querySelector('a[href="/school/settings"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  },
);
it("creates a year and then reads the persisted settings", async () => {
  await render("settings");
  await click("新建学年");
  await fill('input[name="name"]', "2027 学年");
  await fill('input[name="startDate"]', "2027-09-01");
  await fill('input[name="endDate"]', "2028-08-31");
  await click("保存学年");
  expect(commands()).toEqual([
    {
      type: "school.year.save",
      year: { name: "2027 学年", startDate: "2027-09-01", endDate: "2028-08-31" },
    },
  ]);
  expect(api.mock.calls.some(([url]) => url === "/api/platform/school/state")).toBe(true);
  expect(container.querySelector("form")).toBeNull();
});
it.each([
  ["课程", "数学", "course", 3],
  ["教室", "教学楼101", "room", 4],
] as const)(
  "edits and disables a %s with its captured version",
  async (label, name, kind, expectedVersion) => {
    await render("settings");
    await click(`编辑${label}：${name}`);
    await fill('input[name="name"]', `${name}调整`);
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[name="active"]')!.click(),
    );
    await click(`保存${label}`);
    const command = commands()[0] as unknown as Record<string, Record<string, unknown>>;
    expect(command[kind]).toMatchObject({
      id: kind,
      expectedVersion,
      name: `${name}调整`,
      active: false,
    });
  },
);
it("saves an offering with classroom, course, teacher, weekly periods and term revision", async () => {
  await render("settings");
  await click("编辑开课任务");
  await fill('input[name="weeklyPeriods"]', "5");
  await click("保存开课任务");
  expect(commands()[0]).toEqual({
    type: "school.offering.save",
    termId: "term",
    expectedRevision: 2,
    offering: {
      id: "offering",
      courseId: "course",
      classroomId: "class",
      teacherId: "teacher",
      weeklyPeriods: 5,
      active: true,
    },
  });
});
it("retains a conflicting draft until explicit discard and preserves it when rereading fails", async () => {
  api.mockImplementation(async (url) => {
    if (url === "/api/platform/school/commands") throw new ApiRequestError("版本冲突", 409);
    if (url === "/api/platform/school/state") throw new Error("网络中断");
    return {} as never;
  });
  await render("settings");
  await click("编辑课程：数学");
  await fill('input[name="name"]', "需要保留");
  await click("保存课程");
  expect(container.textContent).toContain("系统不会自动重放");
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("需要保留");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("放弃草稿并重新读取");
  expect(api.mock.calls.filter(([url]) => url.endsWith("/state"))).toHaveLength(0);
  confirm.mockReturnValue(true);
  await click("放弃草稿并重新读取");
  expect(container.textContent).toContain("网络中断");
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("需要保留");
  api.mockResolvedValueOnce({ ...state, courses: [{ ...state.courses[0], version: 4 }] } as never);
  await click("放弃草稿并重新读取");
  expect(container.querySelector("form")).toBeNull();
  await click("编辑课程：数学");
  await click("保存课程");
  expect(
    (commands().at(-1) as Extract<SchoolCommand, { type: "school.course.save" }>).course
      .expectedVersion,
  ).toBe(4);
});
it("freezes inputs during save and prevents duplicate submits", async () => {
  let resolve!: (result: unknown) => void;
  api.mockImplementation((url) =>
    url === "/api/platform/school/commands"
      ? (new Promise((finish) => {
          resolve = finish;
        }) as never)
      : (Promise.resolve(state) as never),
  );
  await render("settings");
  await click("编辑课程：数学");
  await click("保存课程");
  expect(container.querySelector("form")!.hasAttribute("inert")).toBe(true);
  await click("正在保存…");
  expect(commands()).toHaveLength(1);
  await act(async () => resolve({ id: "course" }));
});
it("does not resend a saved command when refreshing the state failed", async () => {
  api.mockImplementation(async (url) => {
    if (url.endsWith("/state")) throw new Error("读取失败");
    return { id: "course" } as never;
  });
  await render("settings");
  await click("编辑课程：数学");
  await click("保存课程");
  expect(container.textContent).toContain("保存已成功");
  expect(container.querySelector("form")).toBeNull();
  await click("重新读取教务资料");
  expect(commands()).toHaveLength(1);
});
it("edits structured weekly slots, calendars and overrides without exposing JSON", async () => {
  await render("timetable");
  expect(container.textContent).toContain("师生仍查看已发布 v1");
  await fill(field("周课表 1 单双周"), "ODD");
  await fill(field("周课表 1 起始教学周"), "2");
  await click("添加校历调整");
  await fill(field("校历调整 1 日期"), "2026-10-01");
  await fill(field("校历调整 1 原因"), "国庆停课");
  await click("添加调代课");
  await fill(field("调代课 1 原周课表"), "slot");
  await fill(field("调代课 1 原定上课日期"), "2026-10-05");
  await fill(field("调代课 1 原因"), "学校活动");
  await fill(field("本次排课修改理由"), "安排假期与活动");
  await click("保存排课草稿");
  const command = commands()[0] as Extract<SchoolCommand, { type: "school.timetable.save" }>;
  expect(command).toMatchObject({
    type: "school.timetable.save",
    expectedRevision: 2,
    timetable: {
      slots: [{ parity: "ODD", fromWeek: 2 }],
      calendar: [{ date: "2026-10-01", kind: "CLOSED", sourceDate: null, reason: "国庆停课" }],
      overrides: [{ action: "CANCEL", date: null, periodIds: [], reason: "学校活动" }],
    },
  });
  expect(container.querySelector('textarea[placeholder*="JSON"]')).toBeNull();
});
it("shows conflict details and forbids publication until a clean current revision is checked", async () => {
  api.mockImplementation(async (url) =>
    url.includes("/check?")
      ? ({
          ...preview(),
          conflicts: [
            {
              kind: "TEACHER",
              date: "2026-10-05",
              lessonIds: ["one", "two"],
              message: "张老师同时教授两个班级",
            },
          ],
        } as never)
      : (state as never),
  );
  await render("timetable");
  await click("检查已保存课表");
  expect(container.textContent).toContain("张老师同时教授两个班级");
  expect(container.querySelector('[aria-label="排课冲突"]')?.getAttribute("tabindex")).toBe("0");
  expect(container.textContent).not.toContain("发布草稿 v2");
});
it("lists referencing overrides when removing a slot and blocks saving a dangling source", async () => {
  await render("timetable");
  await click("添加调代课");
  await fill(field("调代课 1 原周课表"), "slot");
  await fill(field("调代课 1 原定上课日期"), "2026-10-05");
  await fill(field("调代课 1 原因"), "学校活动");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await click("移除周课表 1");
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("删除周课表 1？调代课 1 引用了它"));
  expect(container.textContent).toContain("调代课 1 的原周课表已失效，请重选。");
  expect(
    container
      .querySelector<HTMLSelectElement>(field("调代课 1 原周课表"))!
      .getAttribute("aria-invalid"),
  ).toBe("true");
  await fill(field("本次排课修改理由"), "悬挂引用");
  await click("保存排课草稿");
  expect(commands()).toHaveLength(0);
  expect(container.textContent).toContain("调代课 1 的原周课表已失效，请重新选择或删除后再保存。");
  await click("添加周课表");
  await fill(field("周课表 1 开课任务"), "offering");
  const periods = [...container.querySelectorAll("fieldset")].find((entry) =>
    entry.querySelector("legend")?.textContent?.startsWith("周课表 1"),
  )!;
  await act(async () => periods.querySelector<HTMLInputElement>("input")!.click());
  const source = container.querySelector<HTMLSelectElement>(field("调代课 1 原周课表"))!;
  await fill(field("调代课 1 原周课表"), source.options[1].value);
  expect(container.textContent).not.toContain("请重选");
  await click("保存排课草稿");
  expect(commands()).toHaveLength(1);
});
it("publishes a checked draft with an explicit reason and invalidates checks after any edit", async () => {
  await render("timetable");
  await click("检查已保存课表");
  await fill(field("课表发布理由"), "经教务核对");
  await click("发布草稿 v2");
  expect(commands()[0]).toEqual({
    type: "school.timetable.publish",
    termId: "term",
    expectedRevision: 2,
    reason: "经教务核对",
  });
  await click("检查已保存课表");
  await fill(field("节次 1 名称"), "上午第一节");
  expect(container.textContent).not.toContain("发布草稿 v2");
  expect(container.textContent).toContain("请先保存草稿再检查");
});
it("keeps timetable draft after 409 and refuses silent resubmission", async () => {
  api.mockRejectedValueOnce(new ApiRequestError("排课版本冲突", 409));
  await render("timetable");
  await fill(field("节次 1 名称"), "调整第一节");
  await fill(field("本次排课修改理由"), "更改时间");
  await click("保存排课草稿");
  expect(container.textContent).toContain("排课版本冲突");
  await click("保存排课草稿");
  expect(commands()).toHaveLength(1);
  expect(container.querySelector<HTMLInputElement>(field("节次 1 名称"))!.value).toBe("调整第一节");
});
it("recovers a failed schedule read and labels the published version separately", async () => {
  api.mockRejectedValueOnce(new Error("课表网络失败"));
  await render("schedule");
  expect(container.textContent).toContain("课表网络失败");
  await click("重试读取课表");
  expect(container.textContent).toContain("已发布版本 v1");
  expect(container.textContent).toContain("没有可查看的已发布课程");
});
it("ignores stale schedule responses after a date change", async () => {
  let finish!: (data: unknown) => void;
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  await render("schedule");
  await click("下一天");
  expect(container.textContent).toContain("已发布版本 v1");
  await act(async () => finish({ status: "UNPUBLISHED" }));
  expect(container.textContent).toContain("已发布版本 v1");
  expect(container.textContent).not.toContain("课表尚未发布");
});

it("creates a term with explicit timezone and teaching-week anchor", async () => {
  await render("settings");
  await click("新建学期");
  await fill('select[name="yearId"]', "year");
  await fill('input[name="name"]', "春季学期");
  await fill('input[name="startDate"]', "2027-02-01");
  await fill('input[name="endDate"]', "2027-07-01");
  await fill('input[name="weekOneMonday"]', "2027-02-01");
  await click("保存学期");
  expect(commands()[0]).toEqual({
    type: "school.term.save",
    term: {
      yearId: "year",
      name: "春季学期",
      startDate: "2027-02-01",
      endDate: "2027-07-01",
      weekOneMonday: "2027-02-01",
      timezone: "Asia/Shanghai",
      archived: false,
    },
  });
});

it("saves a replacement school day and a teacher substitution as explicit structured entries", async () => {
  await render("timetable");
  await click("添加校历调整");
  await fill(field("校历调整 1 日期"), "2026-10-10");
  await fill(field("校历调整 1 类型"), "REPLACE");
  await fill(field("校历调整 1 采用哪一天的常规课表"), "2026-10-05");
  await fill(field("校历调整 1 原因"), "假期补课");
  await click("添加调代课");
  await fill(field("调代课 1 原周课表"), "slot");
  await fill(field("调代课 1 原定上课日期"), "2026-10-12");
  await fill(field("调代课 1 操作"), "MOVE");
  await fill(field("调代课 1 调整后日期"), "2026-10-13");
  await fill(field("调代课 1 代课教师"), "teacher");
  const periods = [...container.querySelectorAll("fieldset")].find((entry) =>
    entry.querySelector("legend")?.textContent?.startsWith("调代课 1"),
  )!;
  await act(async () => periods.querySelector<HTMLInputElement>("input")!.click());
  await fill(field("调代课 1 原因"), "教师代课");
  await fill(field("本次排课修改理由"), "补课调整");
  await click("保存排课草稿");
  expect(commands()[0]).toMatchObject({
    timetable: {
      calendar: [{ kind: "REPLACE", sourceDate: "2026-10-05" }],
      overrides: [
        {
          action: "MOVE",
          date: "2026-10-13",
          periodIds: ["p1"],
          teacherId: "teacher",
          reason: "教师代课",
        },
      ],
    },
  });
});

it("protects dirty settings on cancellation and page unload", async () => {
  await render("settings");
  await click("编辑课程：数学");
  await fill('input[name="name"]', "修改草稿");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("取消编辑");
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("修改草稿");
  confirm.mockReturnValue(true);
  await click("取消编辑");
  expect(container.querySelector("form")).toBeNull();
});

it("keeps timetable and its dirty protection when explicit reread fails", async () => {
  await render("timetable");
  await fill(field("节次 1 名称"), "未保存节次");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.mockRejectedValueOnce(new Error("重读失败"));
  await click("重新读取排课");
  expect(container.textContent).toContain("重读失败");
  expect(container.querySelector<HTMLInputElement>(field("节次 1 名称"))!.value).toBe("未保存节次");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("removes management controls when a reread reveals permission revocation", async () => {
  await render("settings");
  await click("编辑课程：数学");
  api.mockRejectedValueOnce(new ApiRequestError("权限已收回", 403));
  await click("保存课程");
  api.mockResolvedValueOnce({
    ...state,
    canManage: false,
    years: [],
    courses: [],
    rooms: [],
    teachers: [],
    classrooms: [],
    offerings: [],
  } as never);
  await click("放弃草稿并重新读取");
  expect(container.textContent).toContain("教务设置由学校教务管理人员维护");
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('a[href="/school/timetable"]')).toBeNull();
});

it("renders own published lesson, cancellation reason, and a named keyboard table region", async () => {
  api.mockResolvedValueOnce({
    termId: "term",
    revision: 1,
    timezone: "Asia/Shanghai",
    status: "PUBLISHED",
    lessons: [
      {
        id: "lesson",
        date: "2026-10-15",
        originalDate: "2026-10-14",
        startTime: "08:00",
        endTime: "08:45",
        periodNames: ["第一节"],
        courseName: "数学",
        classroomName: "一班",
        teacherName: "张老师",
        roomName: "教学楼101",
        status: "CANCELLED",
        reason: "活动停课",
      },
    ],
  } as never);
  state.canManage = false;
  state.actor.role = "STUDENT";
  await render("schedule");
  expect(container.textContent).toContain("活动停课");
  expect(container.textContent).toContain("已取消");
  expect(container.textContent).toContain("原日期：2026-10-14");
  expect(container.querySelector('[aria-label="已发布课程表"]')?.getAttribute("tabindex")).toBe(
    "0",
  );
});

it("does not offer a duplicate publication for the current published revision", async () => {
  state.terms[0].publishedRevision = 2;
  await render("timetable");
  await click("检查已保存课表");
  expect(container.textContent).toContain("当前草稿版本已发布");
  expect(container.textContent).not.toContain("发布草稿 v2");
});

it("rereads the same date when the publication revision changes and offers a successful-state refresh", async () => {
  await act(async () => root.render(<SchoolScheduleView term={state.terms[0]} />));
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(<SchoolScheduleView term={{ ...state.terms[0], publishedRevision: 3 }} />),
  );
  expect(api).toHaveBeenCalledTimes(2);
  await click("重新读取课表");
  expect(api).toHaveBeenCalledTimes(3);
  await click("今天");
  expect(api).toHaveBeenCalledTimes(4);
});

it("switches a pristine term directly but protects a dirty timetable before switching", async () => {
  state.terms.push({ ...state.terms[0], id: "term-two", name: "第二学期" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render("timetable");
  await fill(field("查看学期"), "term-two");
  expect(confirm).not.toHaveBeenCalled();
  await fill(field("节次 1 名称"), "待保存节次");
  await fill(field("查看学期"), "term");
  expect(confirm).toHaveBeenCalledOnce();
  expect(container.querySelector<HTMLSelectElement>(field("查看学期"))!.value).toBe("term-two");
  expect(container.querySelector<HTMLInputElement>(field("节次 1 名称"))!.value).toBe("待保存节次");
  confirm.mockReturnValue(true);
  await fill(field("查看学期"), "term");
  expect(container.querySelector<HTMLSelectElement>(field("查看学期"))!.value).toBe("term");
});

it("explains a missing period choice in Chinese without sending an invalid draft", async () => {
  await render("timetable");
  const checkbox = container.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await fill(field("本次排课修改理由"), "调整节次");
  await click("保存排课草稿");
  expect(container.textContent).toContain("请选择上课节次");
  expect(commands()).toHaveLength(0);
  expect(container.textContent).not.toContain("Too small");
});
