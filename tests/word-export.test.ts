import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { Exam } from "@/contracts/exams";
import type { ExamTask } from "@/generated/prisma/client";
const mocks = vi.hoisted(() => ({ browser: vi.fn() }));
vi.mock("@/server/exams/tasks", () => ({ taskDirectory: () => "/tmp/word-export-test" }));
vi.mock("@/server/exams/export/browser", () => ({ withExportPage: mocks.browser }));
import { exportExam } from "@/server/exams/export";
const task = { id: "task", status: "COMPLETED", outputKey: "output" } as ExamTask;
const exam: Exam = {
  id: "exam",
  name: "原生公式测试",
  totalScore: 5,
  sections: [
    {
      id: "section",
      number: "一",
      title: "计算",
      description: "",
      score: 5,
      questions: [
        {
          id: "question",
          number: 1,
          description: String.raw`计算 $\frac{1}{2}+\sqrt{3}$。`,
          score: 5,
          materials: [],
          subquestions: [],
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.browser.mockRejectedValue(new Error("Chromium is unavailable"));
});
describe("browser-free native Word exports", () => {
  it("exports mathematical questions without launching a browser", async () => {
    const result = await exportExam(task, exam, "docx");
    expect(result.mime).toContain("wordprocessingml");
    const zip = await JSZip.loadAsync(result.data);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:rad>");
    expect(xml).not.toContain("<w:drawing");
    expect(mocks.browser).not.toHaveBeenCalled();
  });
  it("retains Chromium as the PDF rendering backend", async () => {
    await expect(exportExam(task, exam, "pdf")).rejects.toMatchObject({
      code: "EXAM_EXPORT_FAILED",
    });
    expect(mocks.browser).toHaveBeenCalledOnce();
  });
  it("honors cancellation before converting or packing the document", async () => {
    await expect(exportExam(task, exam, "docx", AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.browser).not.toHaveBeenCalled();
  });
});
