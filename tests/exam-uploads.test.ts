import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { receiveExamUpload } from "@/server/exams/uploads";
const roots: string[] = [];
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6TfsAAAAASUVORK5CYII=",
  "base64",
);
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "paper-upload-"));
  roots.push(root);
  return join(root, "inputs");
}
function request(fields: { field: string; data?: Uint8Array }[]) {
  const form = new FormData();
  fields.forEach(({ field, data }, index) =>
    form.append(
      field,
      new File([new Uint8Array(data ?? image)], `page-${index}.png`, { type: "image/png" }),
    ),
  );
  return new Request("http://localhost/api/quick-grade", { method: "POST", body: form });
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("separate student and reference uploads", () => {
  it("accepts bounded task model choices and rejects malformed, duplicate or unsupported choices", async () => {
    const model = "10000000-0000-4000-8000-000000000001";
    for (const [values, valid] of [
      [[JSON.stringify({ exam: model })], true],
      [[JSON.stringify({ answer: model })], false],
      [[JSON.stringify({ exam: model, multiplier: 0 })], false],
      [["broken"], false],
      [["x".repeat(1025)], false],
      [["{}", "{}"], false],
    ] as const) {
      const form = new FormData();
      form.append("files", new File([image], "page.png", { type: "image/png" }));
      for (const value of values) form.append("models", value);
      let choice: unknown;
      const result = receiveExamUpload(
        new Request("http://localhost", { method: "POST", body: form }),
        await directory(),
        {
          modelPurposes: ["exam"],
          onModels: (models) => {
            choice = models;
          },
        },
      );
      if (valid) {
        await result;
        expect(choice).toEqual({ exam: model });
      } else await expect(result).rejects.toThrow();
    }
  });
  it("preserves file order within each field without mixing answer pages into student pages", async () => {
    const files = await receiveExamUpload(
      request([{ field: "answerFiles" }, { field: "files" }, { field: "answerFiles" }]),
      await directory(),
      { allowAnswers: true },
    );
    expect(files.map((file) => file.field)).toEqual(["answerFiles", "files", "answerFiles"]);
    expect(files.map((file) => file.path.split("/").at(-1))).toEqual([
      "answer-1.upload",
      "2.upload",
      "answer-3.upload",
    ]);
  });
  it("rejects answer-only quick submissions, unsupported fields and invalid reference signatures", async () => {
    for (const fields of [
      [{ field: "answerFiles" }],
      [{ field: "files" }, { field: "other" }],
      [
        { field: "files" },
        { field: "answerFiles", data: new TextEncoder().encode("invalid image") },
      ],
    ]) {
      const path = await directory();
      await expect(
        receiveExamUpload(request(fields), path, { allowAnswers: true }),
      ).rejects.toThrow();
      await expect(access(path)).rejects.toThrow();
    }
  });
  it("keeps student-only upload receivers single-purpose and enforces combined file limits", async () => {
    await expect(
      receiveExamUpload(request([{ field: "files" }, { field: "answerFiles" }]), await directory()),
    ).rejects.toThrow("上传字段无效");
    await expect(
      receiveExamUpload(
        request(
          Array.from({ length: 21 }, (_, index) => ({
            field: index % 2 ? "answerFiles" : "files",
          })),
        ),
        await directory(),
        { allowAnswers: true },
      ),
    ).rejects.toThrow("20 个文件");
  });
});
