import { beforeEach, expect, it, vi } from "vitest";
import { uploadScans } from "@/server/platform/scan-upload";
import type { PlatformState } from "@/contracts/platform";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  executeCommand: vi.fn(),
  resolveScanSources: vi.fn(),
  processCardScan: vi.fn(),
  cropWorkbook: vi.fn(),
  saveImage: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({ homeworkAssignment: { findUnique: async () => null } }),
}));
vi.mock("@/server/platform/service", () => ({
  loadState: mocks.loadState,
  executeCommand: mocks.executeCommand,
}));
vi.mock("@/server/platform/scan-sources", () => ({ resolveScanSources: mocks.resolveScanSources }));
vi.mock("@/server/platform/scan", () => ({
  processCardScan: mocks.processCardScan,
  cropWorkbook: mocks.cropWorkbook,
}));
vi.mock("@/server/platform/assets", () => ({ saveImage: mocks.saveImage }));

let form: FormData;
beforeEach(() => {
  vi.resetAllMocks();
  form = new FormData();
  for (const [key, value] of Object.entries({
    kind: "CARD",
    assessmentId: "exam",
    rosterRevision: "1",
    paperId: "paper",
    templateId: "card",
  }))
    form.set(key, value);
  mocks.loadState.mockResolvedValue({
    actor: { role: "TEACHER" },
    assessments: [
      {
        id: "exam",
        papers: [{ paperId: "paper" }],
        classroomIds: ["class"],
        rosterRevision: 1,
        rosterStatus: "CONFIRMED",
        participants: ["s1", "s2"].map((studentId, index) => ({
          id: `p-${studentId}`,
          studentId,
          name: index ? "学生二" : "学生一",
          studentNumber: String(index + 1),
          classroomId: "class",
          classroomName: "一班",
          stage: "高中",
          cohort: "2027届",
          subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
        })),
      },
    ],
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

it("matches the captured exam card number after live students or card numbers change", async () => {
  const state = (await mocks.loadState()) as PlatformState;
  state.classrooms[0].students = [
    { id: "new-student", name: "新加入", studentNumber: "1" },
  ] as PlatformState["classrooms"][number]["students"];
  scans(["000001", null, null]);
  expect(await uploadScans("teacher", form)).toMatchObject({ imported: 1, issues: [] });
  expect(mocks.executeCommand.mock.calls[0][1].submission).toMatchObject({
    studentId: "s1",
    rosterRevision: 1,
  });
});

it.each(["ABSENT", "EXEMPT", "WITHDRAWN"] as const)(
  "rejects a specified %s student before processing files",
  async (status) => {
    const state = (await mocks.loadState()) as PlatformState;
    state.assessments[0].participants[0].subjects[0].status = status;
    form.set("studentId", "s1");
    await expect(uploadScans("teacher", form)).rejects.toThrow("应考名单");
    expect(mocks.resolveScanSources).not.toHaveBeenCalled();
  },
);

it("does not import a recognized card number for a non-required participant", async () => {
  const state = (await mocks.loadState()) as PlatformState;
  state.assessments[0].participants[0].subjects[0].status = "ABSENT";
  scans(["000001", null, null]);
  const result = await uploadScans("teacher", form);
  expect(result.imported).toBe(0);
  expect(result.issues.some((issue) => issue.error.includes("无法唯一匹配"))).toBe(true);
  expect(mocks.executeCommand).not.toHaveBeenCalled();
});

it("requires the confirmed current roster version before reading scan sources", async () => {
  form.set("rosterRevision", "0");
  await expect(uploadScans("teacher", form)).rejects.toThrow("名单版本");
  form.set("rosterRevision", "2");
  await expect(uploadScans("teacher", form)).rejects.toThrow("名单已更新");
  const state = (await mocks.loadState()) as PlatformState;
  state.assessments[0].rosterStatus = "NEEDS_REVIEW";
  form.set("rosterRevision", "1");
  await expect(uploadScans("teacher", form)).rejects.toThrow("核对并确认");
  expect(mocks.resolveScanSources).not.toHaveBeenCalled();
});

async function workbookPages() {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(join(tmpdir(), "multi-region-test-"));
  const crop = join(directory, "crop.png");
  await writeFile(crop, "crop");
  form.set("kind", "WORKBOOK");
  form.set("studentId", "s1");
  // The intended reading order deliberately starts on the second page.
  const boxes = [
    { itemId: "item-1", page: 2, x: 0, y: 0, width: 0.5, height: 0.2 },
    { itemId: "item-1", page: 1, x: 0, y: 0.2, width: 0.5, height: 0.2 },
    { itemId: "item-2", page: 1, x: 0, y: 0.4, width: 0.5, height: 0.2 },
    { itemId: "item-3", page: 2, x: 0, y: 0.6, width: 0.5, height: 0.2 },
    { itemId: "item-1", page: 2, x: 0.5, y: 0, width: 0.5, height: 0.2 },
  ];
  form.set("boxes", JSON.stringify(boxes));
  mocks.resolveScanSources.mockResolvedValue(
    [1, 2].map((page) => ({
      name: `${page}.png`,
      buffer: Buffer.from("page"),
      assetUrl: `/api/platform/assets/page-${page}`,
    })),
  );
  mocks.cropWorkbook.mockImplementation(async ({ regions }) => ({
    answers: regions.map((box: (typeof boxes)[number]) => ({
      itemId: box.itemId,
      text: `${box.page}:${box.x}`,
      images: [crop],
      box,
    })),
    alignment: { manual: true },
    needsReview: false,
  }));
  let asset = 0;
  mocks.saveImage.mockImplementation(async () => ({ url: `/api/platform/assets/crop-${++asset}` }));
  return { boxes, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

it("merges same-page and cross-page fragments into one answer in the teacher's region order", async () => {
  const fixture = await workbookPages();
  try {
    expect(await uploadScans("teacher", form)).toMatchObject({ imported: 1, issues: [] });
    const saved = mocks.executeCommand.mock.calls[0][1].submission;
    expect(saved.answers).toHaveLength(3);
    expect(saved.answers[0]).toMatchObject({
      itemId: "item-1",
      text: "2:0\n1:0\n2:0.5",
      images: [
        "/api/platform/assets/crop-3",
        "/api/platform/assets/crop-1",
        "/api/platform/assets/crop-5",
      ],
      sourcePage: "/api/platform/assets/page-2",
      box: { page: 2 },
    });
    expect(saved.alignment.workbookRegions).toEqual(fixture.boxes);
  } finally {
    await fixture.cleanup();
  }
});

it("does not save a partial answer if a continuation page fails", async () => {
  const fixture = await workbookPages();
  try {
    mocks.cropWorkbook.mockRejectedValueOnce(new Error("broken page"));
    const result = await uploadScans("teacher", form);
    expect(result.imported).toBe(0);
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  } finally {
    await fixture.cleanup();
  }
});

it("rejects more than thirty regions for one question before cropping", async () => {
  const fixture = await workbookPages();
  try {
    form.set(
      "boxes",
      JSON.stringify([
        ...Array.from({ length: 31 }, () => fixture.boxes[0]),
        ...fixture.boxes.slice(2, 4),
      ]),
    );
    await expect(uploadScans("teacher", form)).rejects.toThrow("完整覆盖");
    expect(mocks.cropWorkbook).not.toHaveBeenCalled();
  } finally {
    await fixture.cleanup();
  }
});
