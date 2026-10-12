import { afterEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_LIMITS } from "@/contracts/exam-tasks";
import { mergeExamFiles, submitExamUpload } from "@/lib/exam-upload";

function file(name: string, size = 1): File {
  return { name, size, lastModified: 1 } as File;
}

describe("exam file selection", () => {
  it("preserves page order, accepts uppercase extensions, and ignores duplicate selections", () => {
    const first = file("first.PDF");
    const second = file("second.jpeg");
    expect(mergeExamFiles([first], [second, first])).toEqual([first, second]);
  });

  it.each([
    ["document.docx", 1],
    ["empty.pdf", 0],
    ["large.png", UPLOAD_LIMITS.fileBytes + 1],
  ])("rejects invalid file %s without modifying the current selection", (name, size) => {
    const current = [file("saved.pdf")];
    expect(() => mergeExamFiles(current, [file("valid.png"), file(name, size)])).toThrow();
    expect(current.map((item) => item.name)).toEqual(["saved.pdf"]);
  });

  it("checks both file count and combined size", () => {
    expect(() =>
      mergeExamFiles(
        [],
        Array.from({ length: 21 }, (_, index) => file(`${index}.png`)),
      ),
    ).toThrow("20");
    expect(() =>
      mergeExamFiles(
        [],
        Array.from({ length: 3 }, (_, index) => file(`${index}.pdf`, 40 * 1024 * 1024)),
      ),
    ).toThrow("100 MB");
  });
});

describe("exam upload transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  function request() {
    const xhr = {
      upload: {} as {
        onprogress: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
      },
      open: vi.fn(),
      send: vi.fn(),
      status: 202,
      response: { task: { id: "saved-task" } },
      onload: () => {},
      onabort: () => {},
      onerror: () => {},
      ontimeout: () => {},
    };
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        constructor() {
          return xhr;
        }
      },
    );
    const onProgress = vi.fn();
    const onRequest = vi.fn();
    const pending = submitExamUpload({
      files: [new File(["page"], "paper.pdf")],
      mode: "quick",
      templateId: "template-id",
      generateAnswers: false,
      onProgress,
      onRequest,
    });
    return { xhr, pending, onProgress, onRequest };
  }

  it("sends the files and template, reports progress, and resolves the accepted task", async () => {
    const { xhr, pending, onProgress, onRequest } = request();
    expect(xhr.open).toHaveBeenCalledWith(
      "POST",
      "/api/exams?mode=quick&generateAnswers=false&templateId=template-id",
    );
    expect(onRequest).toHaveBeenCalledWith(xhr);
    const body = xhr.send.mock.calls[0][0] as FormData;
    expect((body.get("files") as File).name).toBe("paper.pdf");
    xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
    expect(onProgress).toHaveBeenCalledWith(50);
    xhr.onload();
    await expect(pending).resolves.toBe("saved-task");
  });

  it.each(["onabort", "onerror", "ontimeout"] as const)("rejects when %s fires", async (event) => {
    const { xhr, pending } = request();
    xhr[event]();
    await expect(pending).rejects.toThrow();
  });

  it("preserves API error messages", async () => {
    const { xhr, pending } = request();
    xhr.status = 503;
    Object.assign(xhr, { response: { error: "处理服务尚未准备好。" } });
    xhr.onload();
    await expect(pending).rejects.toThrow("处理服务尚未准备好。");
  });
});
