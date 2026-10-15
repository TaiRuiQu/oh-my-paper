import { beforeEach, expect, it, vi } from "vitest";
import { uploadScans } from "@/server/platform/scan-upload";
import type { PlatformState } from "@/contracts/platform";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  executeCommand: vi.fn(),
  resolveScanSources: vi.fn(),
  processCardScan: vi.fn(),
}));
vi.mock("@/server/platform/service", () => ({
  loadState: mocks.loadState,
  executeCommand: mocks.executeCommand,
}));
vi.mock("@/server/platform/scan-sources", () => ({ resolveScanSources: mocks.resolveScanSources }));
vi.mock("@/server/platform/scan", () => ({
  processCardScan: mocks.processCardScan,
  cropWorkbook: vi.fn(),
}));
vi.mock("@/server/platform/assets", () => ({ saveImage: vi.fn() }));

let form: FormData;
beforeEach(() => {
  vi.resetAllMocks();
  form = new FormData();
  for (const [key, value] of Object.entries({
    kind: "CARD",
    assessmentId: "exam",
    paperId: "paper",
    templateId: "card",
  }))
    form.set(key, value);
  mocks.loadState.mockResolvedValue({
    actor: { role: "TEACHER" },
    assessments: [{ id: "exam", papers: [{ paperId: "paper" }], classroomIds: ["class"] }],
    papers: [{ id: "paper", items: [1, 2, 3].map((n) => ({ id: `item-${n}` })) }],
    templates: [
      { id: "card", paperId: "paper", layout: { pageCount: 3, headerMode: "FIRST_PAGE" } },
    ],
    classrooms: [
      {
        id: "class",
        students: [
          { id: "s1", name: "学生一", studentNumber: "1" },
          { id: "s2", name: "学生二", studentNumber: "2" },
        ],
      },
    ],
    submissions: [],
  });
  mocks.executeCommand.mockResolvedValue({ id: "submission" });
});

function scans(numbers: (string | null)[]) {
  mocks.resolveScanSources.mockResolvedValue(
    numbers.map((_, index) => ({
      name: `page-${index}.png`,
      buffer: Buffer.from("scan"),
      assetUrl: `/api/assets/page-${index}.png`,
    })),
  );
  for (const [index, studentNumber] of numbers.entries()) {
    const page = (index % 3) + 1;
    mocks.processCardScan.mockResolvedValueOnce({
      studentNumber,
      answers: [{ itemId: `item-${page}`, text: "", images: [] }],
      alignment: { page },
      needsReview: false,
    });
  }
}

it("assigns headerless continuation pages to their first page and resets identity between students", async () => {
  scans(["000001", null, null, "000002", null, null]);
  const result = await uploadScans("teacher", form);
  expect(result).toMatchObject({ imported: 2, issues: [] });
  expect(mocks.executeCommand.mock.calls.map((call) => call[1].submission)).toMatchObject([
    {
      studentId: "s1",
      sourceFiles: ["/api/assets/page-0.png", "/api/assets/page-1.png", "/api/assets/page-2.png"],
    },
    {
      studentId: "s2",
      sourceFiles: ["/api/assets/page-3.png", "/api/assets/page-4.png", "/api/assets/page-5.png"],
    },
  ]);
});

it("does not inherit the previous student's identity when the next first page cannot be read", async () => {
  scans(["000001", null, null, null, null, null]);
  const result = await uploadScans("teacher", form);
  expect(result.imported).toBe(1);
  expect(result.issues).toHaveLength(3);
  expect(mocks.executeCommand.mock.calls[0][1].submission.studentId).toBe("s1");
});

it("rejects conflicting identities on later odd pages", async () => {
  const state = (await mocks.loadState()) as PlatformState;
  state.templates[0].layout.headerMode = "ODD_PAGES";
  scans(["000001", null, "000002"]);
  const result = await uploadScans("teacher", form);
  expect(result.imported).toBe(0);
  expect(result.issues.some((issue) => issue.error.includes("学生身份不一致"))).toBe(true);
  expect(mocks.executeCommand).not.toHaveBeenCalled();
});

it("allows a teacher-selected student to identify all pages", async () => {
  form.set("studentId", "s2");
  scans([null, null, null]);
  expect(await uploadScans("teacher", form)).toMatchObject({ imported: 1, issues: [] });
  expect(mocks.executeCommand.mock.calls[0][1].submission.studentId).toBe("s2");
});
