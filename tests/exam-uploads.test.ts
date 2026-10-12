import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { receiveExamUpload } from "@/server/exams/uploads";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(join(tmpdir(), "exam-upload-test-")); roots.push(root); return join(root, "inputs"); }
async function request(count = 1) {
  const form = new FormData();
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  for (let index = 0; index < count; index++) form.append("files", new Blob([new Uint8Array(image)], { type: "image/png" }), `page-${index}.png`);
  return new Request("http://localhost/api/exams", { method: "POST", body: form });
}
describe("streamed exam uploads", () => {
  it("retains multipart file order and accepts the full 20-file limit", async () => {
    const dir = await directory();
    const files = await receiveExamUpload(await request(20), dir);
    expect(files).toHaveLength(20);
    expect(files[19].name).toBe("page-19.png");
    expect(files[19].path).toBe(join(dir, "20.upload"));
    expect((await readFile(files[0].path)).subarray(1, 4).toString()).toBe("PNG");
  });
  it("rejects extra files and removes the partial upload", async () => {
    const dir = await directory();
    await expect(receiveExamUpload(await request(21), dir)).rejects.toMatchObject({ status: 413 });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves Chinese upload names without using them as storage paths", async () => {
    const form = new FormData(); const req = await request(); const original = await req.formData();
    form.append("files", original.get("files") as Blob, "../数学试卷.png");
    const files = await receiveExamUpload(new Request("http://localhost", { method: "POST", body: form }), await directory());
    expect(files[0].name).toBe("数学试卷.png");
    expect(files[0].path.endsWith("/1.upload")).toBe(true);
  });
  it("checks the actual file signature rather than trusting MIME and extension", async () => {
    const dir = await directory(); const form = new FormData();
    form.append("files", new Blob(["not an image"], { type: "image/png" }), "exam.png");
    await expect(receiveExamUpload(new Request("http://localhost", { method: "POST", body: form }), dir)).rejects.toMatchObject({ status: 422 });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects oversized declared bodies before touching the filesystem", async () => {
    const dir = await directory(); const req = await request(); req.headers.set("content-length", String(101 * 1024 * 1024));
    await expect(receiveExamUpload(req, dir)).rejects.toMatchObject({ status: 413 });
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects malformed multipart input and empty selections", async () => {
    await expect(receiveExamUpload(new Request("http://localhost", { method: "POST", body: "bad" }), await directory())).rejects.toMatchObject({ status: 400 });
    const form = new FormData();
    await expect(receiveExamUpload(new Request("http://localhost", { method: "POST", body: form }), await directory())).rejects.toMatchObject({ status: 400 });
  });
});
