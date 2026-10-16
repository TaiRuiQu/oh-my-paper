// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { Assessment, PlatformState } from "@/contracts/platform";
import { ClassDetailPage } from "@/components/platform/class-pages";
import { HomeOverviewPage } from "@/components/platform/home-pages";
let state: PlatformState, host: HTMLDivElement, root: Root;
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state, mutate: vi.fn(), pending: false, refresh: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const arrangement = (published: boolean, rosterStatus: Assessment["rosterStatus"]): Assessment => ({
  id: "assessment",
  ownerId: "owner",
  name: "历史安排",
  kind: "EXAM",
  reviewScope: "CLASSROOM",
  classroomIds: ["class"],
  papers: [
    {
      paperId: "paper",
      subject: "数学",
      gradingMode: "SINGLE",
      arbitrationThreshold: 2,
      conversion: { enabled: false, bands: [] },
    },
  ],
  published,
  rosterStatus,
  rosterRevision: 1,
  createdAt: "2026-10-15T01:00:00Z",
  participants: [],
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state = {
    actor: { id: "owner", name: "教师", role: "TEACHER" },
    classrooms: [
      {
        id: "class",
        ownerId: "owner",
        name: "一班",
        stage: "高中",
        cohort: "2027届",
        students: [],
      },
    ],
    assessments: [],
    questions: [],
    questionCount: 0,
    papers: [],
    submissions: [],
    reviews: [],
    reviewAssignments: [],
    templates: [],
    users: [],
    analytics: { results: [], students: [], classrooms: [], knowledge: [] },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it.each([
  { published: true, rosterStatus: "NEEDS_REVIEW" as const, label: "名单待确认 · 学生暂不可见" },
  { published: false, rosterStatus: "NEEDS_REVIEW" as const, label: "名单待确认 · 学生暂不可见" },
  { published: false, rosterStatus: "CONFIRMED" as const, label: "进行中" },
  { published: true, rosterStatus: "CONFIRMED" as const, label: "成绩已发布" },
])(
  "class and home agree for published=$published roster=$rosterStatus",
  async ({ published, rosterStatus, label }) => {
    state.assessments = [arrangement(published, rosterStatus)];
    await act(async () => root.render(<ClassDetailPage id="class" />));
    const classRow = [...host.querySelectorAll(".p-list-row")].find((node) =>
      node.textContent?.includes("历史安排"),
    );
    expect(classRow?.textContent).toContain(label);
    if (rosterStatus === "NEEDS_REVIEW") expect(classRow?.textContent).not.toContain("成绩已发布");
    await act(async () => root.render(<HomeOverviewPage />));
    const homeRow = [...host.querySelectorAll(".p-list-row")].find((node) =>
      node.textContent?.includes("历史安排"),
    );
    expect(homeRow?.textContent).toContain(label);
    if (rosterStatus === "NEEDS_REVIEW") expect(homeRow?.textContent).not.toContain("成绩已发布");
  },
);
