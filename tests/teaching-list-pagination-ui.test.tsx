// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SchoolState, SchoolSchedule } from "@/contracts/school";
import type { TeachingSession, TeachingSessions } from "@/contracts/teaching";
import { TeachingWorkspace } from "@/components/teaching/workspace";
import { apiRequest } from "@/lib/http-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/platform/use-ai-progress", () => ({
  useAiProgress: () => ({ models: [], jobs: [], loading: false, failure: "", reconnect: vi.fn() }),
}));
vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
let root: Root, host: HTMLDivElement;
const lesson = {
  id: "lesson",
  termId: "term",
  offeringId: "offering",
  slotId: "slot",
  originalDate: "2026-10-15",
  date: "2026-10-15",
  startTime: "08:00",
  endTime: "08:45",
  courseId: "course",
  courseName: "数学",
  classroomId: "class",
  classroomName: "一班",
  teacherId: "teacher",
  teacherName: "张老师",
  roomId: null,
  roomName: null,
  periodNames: ["第1节"] as string[],
  status: "SCHEDULED",
  reason: "",
} as const;
const school: SchoolState = {
  actor: { id: "teacher", role: "TEACHER", name: "张老师" },
  canManage: false,
  years: [],
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
      revision: 3,
      publishedRevision: 3,
      publishedAt: "2026-10-01T00:00:00Z",
    },
  ],
  courses: [],
  rooms: [],
  teachers: [],
  classrooms: [],
  offerings: [],
  publications: [],
};
function session(id: string): TeachingSession {
  return {
    id,
    termId: "term",
    slotId: `slot-${id}`,
    originalDate: "2026-10-14",
    version: 2,
    bindingVersion: 1,
    status: "COMPLETED",
    binding: {
      publicationId: "publication",
      publicationRevision: 3,
      timezone: "Asia/Shanghai",
      lessonIds: [lesson.id],
      lessons: [lesson],
    },
    planVersion: 1,
    confirmedPlanVersion: 1,
    plan: null,
    rosterFingerprint: null,
    rosterConfirmed: true,
    participants: [],
    summary: "已完成",
    reflection: "反思",
    startedAt: null,
    finishedAt: null,
    interruptedAt: null,
    currentSchedule: null,
    scheduleChanged: false,
    canPrepare: false,
    canRebind: false,
    canCancel: false,
    canManageRoster: false,
    canTakeAttendance: false,
    canStart: false,
    canFinish: false,
    canCorrect: false,
    blockReasons: [],
  };
}
const list = (rows: TeachingSession[], nextBeforeId: string | null): TeachingSessions => ({
  actor: school.actor,
  canManage: false,
  sessions: rows,
  nextBeforeId,
});
const schedule: SchoolSchedule = {
  termId: "term",
  publicationId: "publication",
  revision: 3,
  timezone: "Asia/Shanghai",
  startDate: "2026-10-15",
  endDate: "2026-10-15",
  status: "PUBLISHED",
  lessons: [lesson],
};
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api.mockImplementation(async (url) =>
    url === "/api/platform/school/state"
      ? school
      : url.startsWith("/api/platform/school/schedule?")
        ? schedule
        : list([], null),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(initial: TeachingSessions) {
  await act(async () => root.render(<TeachingWorkspace section="list" initialList={initial} />));
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((entry) => entry.textContent === text)!;
}

it("invalidates a slow older-page response when a refresh starts, without mixing stale rows", async () => {
  let finishOlder!: (value: TeachingSessions) => void;
  const refreshRows = list([session("fresh")], null);
  api.mockImplementation((url) => {
    if (url === "/api/platform/school/state") return Promise.resolve(school);
    if (url.startsWith("/api/platform/school/schedule?")) return Promise.resolve(schedule);
    if (url.includes("beforeId=cursor"))
      return new Promise((resolve) => {
        finishOlder = resolve;
      });
    if (url === "/api/platform/teaching/sessions") return Promise.resolve(refreshRows);
    return Promise.resolve(list([], null));
  });
  await render(list([session("current")], "cursor"));
  await act(async () => button("读取更早课堂").click());
  await act(async () => button("重新读取教学记录").click());
  expect(host.querySelector('a[href="/school/teaching/fresh"]')).not.toBeNull();
  await act(async () => finishOlder(list([session("stale")], null)));
  expect(host.querySelector('a[href="/school/teaching/stale"]')).toBeNull();
  expect(host.querySelector('a[href="/school/teaching/fresh"]')).not.toBeNull();
});

it("does not issue duplicate older-page requests while one is pending and deduplicates IDs on append", async () => {
  let finish!: (value: TeachingSessions) => void;
  api.mockImplementation((url) =>
    url.includes("beforeId=cursor")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : url === "/api/platform/school/state"
        ? Promise.resolve(school)
        : url.startsWith("/api/platform/school/schedule?")
          ? Promise.resolve(schedule)
          : Promise.resolve(list([], null)),
  );
  await render(list([session("current")], "cursor"));
  await act(async () => {
    button("读取更早课堂").click();
    button("读取更早课堂").click();
  });
  expect(api.mock.calls.filter(([url]) => url.includes("beforeId=cursor"))).toHaveLength(1);
  await act(async () => finish(list([session("current"), session("older")], null)));
  expect(host.querySelectorAll('a[href^="/school/teaching/"]').length).toBe(2);
});

it("keeps the original list after an older-page failure and allows a retry", async () => {
  let attempt = 0;
  let finish!: (value: TeachingSessions) => void;
  api.mockImplementation((url) => {
    if (url.includes("beforeId=cursor")) {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error("历史暂不可读"))
        : new Promise((resolve) => {
            finish = resolve;
          });
    }
    return url === "/api/platform/school/state"
      ? Promise.resolve(school)
      : url.startsWith("/api/platform/school/schedule?")
        ? Promise.resolve(schedule)
        : Promise.resolve(list([], null));
  });
  await render(list([session("current")], "cursor"));
  await act(async () => button("读取更早课堂").click());
  expect(host.textContent).toContain("历史暂不可读");
  expect(host.querySelector('a[href="/school/teaching/current"]')).not.toBeNull();
  await act(async () => button("读取更早课堂").click());
  await act(async () => finish(list([session("older")], null)));
  expect(host.querySelector('a[href="/school/teaching/older"]')).not.toBeNull();
});
