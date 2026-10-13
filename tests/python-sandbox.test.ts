import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createInspectionTools } from "@/server/exams/tools";
import { pythonInputSchema, runSandboxPython } from "@/server/exams/python-sandbox";
import { parseExam } from "@/server/exams/parser";
import type { ExamModel } from "@/server/ai/providers";

const roots: string[] = [];
const options = { toolCallId: "python", messages: [], context: {} };
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "python-sandbox-"));
  roots.push(root);
  await mkdir(join(root, "pages"));
  await mkdir(join(root, "agent"));
  const path = join(root, "pages/001.jpg");
  const marker = await sharp({
    create: { width: 50, height: 100, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  await sharp({ create: { width: 100, height: 200, channels: 3, background: "red" } })
    .composite([{ input: marker, left: 0, top: 0 }])
    .jpeg()
    .toFile(path);
  const pages = [{ page: 1, width: 100, height: 200, path }];
  return { root, pages, path };
}
const rotate = {
  code: 'from PIL import Image\nim = Image.open("pages/001.jpg")\nim.rotate(90, expand=True).save("output/rotated.png")\nprint("rotated", im.size)',
  images: ["rotated.png"],
  replacePages: [{ page: 1, image: "rotated.png" }],
};

describe("local Python sandbox", () => {
  it("executes arbitrary Python with Pillow while hiding host files, secrets and network", async () => {
    const { root, pages } = await fixture();
    const secretFile = join(root, "host-secret.txt");
    await writeFile(secretFile, "host secret");
    vi.stubEnv("PYTHON_SANDBOX_TEST_SECRET", "secret env");
    const result = await runSandboxPython({
      pages,
      directory: root,
      images: [],
      code: `import os, socket\nfrom PIL import Image\nassert os.getuid() == 65534\nassert "PYTHON_SANDBOX_TEST_SECRET" not in os.environ\nassert not os.path.exists(${JSON.stringify(secretFile)})\nassert not os.path.exists("/home/xiaoq/Documents/oh-my-paper/.env")\ntry:\n    open("pages/001.jpg", "wb")\n    raise AssertionError("source was writable")\nexcept OSError:\n    pass\ns = socket.socket()\ns.settimeout(0.1)\ntry:\n    s.connect(("1.1.1.1", 80))\n    raise AssertionError("network was available")\nexcept OSError:\n    pass\nprint(sum(i*i for i in range(10)))\nprint(Image.open("pages/001.jpg").size)`,
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "", images: [] });
    expect(result.stdout).toContain("285\n(100, 200)");
    expect(await readdir(join(root, ".python"))).toEqual([]);
  });
  it("returns rotated images to the model and uses the corrected page for later reads and crops", async () => {
    const { root, pages, path } = await fixture();
    const source = await readFile(path);
    const tools = createInspectionTools(pages, root);
    const result = await tools.python.execute!(rotate, options);
    if (!("images" in result)) throw new Error("Expected a completed Python result");
    expect(result).toMatchObject({ exitCode: 0, pages: [{ page: 1, width: 200, height: 100 }] });
    expect(result.images).toHaveLength(1);
    const modelOutput = await tools.python.toModelOutput!({
      toolCallId: "python",
      input: rotate,
      output: result,
    });
    expect(modelOutput).toMatchObject({
      type: "content",
      value: [{ type: "text" }, { type: "file", mediaType: "image/jpeg" }],
    });
    expect(await tools.read_pages.execute!({ pages: [1] }, options)).toMatchObject({
      images: result.images,
      pages: [{ width: 200, height: 100 }],
    });
    const crop = await tools.inspect_image.execute!(
      { region: { page: 1, x: 0, y: 0, width: 0.5, height: 0.5 }, scale: 1, sharpen: false },
      options,
    );
    expect(crop).toMatchObject({ width: 100, height: 50 });
    expect(await readFile(path)).toEqual(source);
  });
  it("keeps preview-only processing from changing the page, and reports Python exceptions", async () => {
    const { root, pages, path } = await fixture();
    const tools = createInspectionTools(pages, root);
    const preview = await tools.python.execute!({ ...rotate, replacePages: [] }, options);
    if (!("images" in preview)) throw new Error("Expected a completed Python result");
    expect(preview.images).toHaveLength(1);
    expect(pages[0]).toMatchObject({ width: 100, height: 200, path });
    const failure = await tools.python.execute!(
      { code: 'raise ValueError("bad angle")', images: [], replacePages: [] },
      options,
    );
    if (!("stderr" in failure)) throw new Error("Expected a completed Python result");
    expect(failure).toMatchObject({ exitCode: 1, images: [], pages: [] });
    expect(failure.stderr).toContain("ValueError: bad angle");
    expect(pages[0].path).toBe(path);
  });
  it("rejects invalid export filenames and page update references", async () => {
    for (const name of ["../secret.png", "/tmp/image.png", "x.py", "x.png/../../secret"])
      expect(
        pythonInputSchema.safeParse({ code: "print(1)", images: [name], replacePages: [] }).success,
      ).toBe(false);
    const { root, pages } = await fixture();
    const tools = createInspectionTools(pages, root);
    await expect(tools.python.execute!({ ...rotate, images: [] }, options)).rejects.toMatchObject({
      code: "PAGE_UPDATE_INVALID",
    });
    await expect(
      tools.python.execute!(
        { ...rotate, replacePages: [{ page: 2, image: "rotated.png" }] },
        options,
      ),
    ).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
  });
  it("kills timed-out code and cleans the request directory without a host execution fallback", async () => {
    const { root, pages } = await fixture();
    await expect(
      runSandboxPython({
        code: "while True: pass",
        images: [],
        pages,
        directory: root,
        timeoutMs: 150,
      }),
    ).rejects.toMatchObject({ code: "PYTHON_SANDBOX_FAILED" });
    expect(await readdir(join(root, ".python"))).toEqual([]);
    vi.stubEnv("BWRAP_PATH", "/nonexistent/bwrap");
    await expect(
      runSandboxPython({ code: "print(1)", images: [], pages, directory: root }),
    ).rejects.toMatchObject({ code: "PYTHON_SANDBOX_FAILED" });
  });
  it("honors the SDK tool cancellation signal and removes the temporary request", async () => {
    const { root, pages } = await fixture();
    const tools = createInspectionTools(pages, root);
    await expect(
      tools.python.execute!(
        { code: "while True: pass", images: [], replacePages: [] },
        { ...options, abortSignal: AbortSignal.timeout(150) },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(await readdir(join(root, ".python"))).toEqual([]);
  });
  it("crops final materials from the rotated page and prevents changing saved coordinate references", async () => {
    const { root, path } = await fixture();
    const generate: ExamModel["generate"] = async ({ tools, onProgress }) => {
      const result = await tools!.python.execute!(rotate, options);
      expect(result).toMatchObject({ pages: [{ width: 200, height: 100 }] });
      const exam = {
        name: "旋转试卷",
        totalScore: null,
        sections: [
          {
            number: "一",
            title: "题目",
            description: "",
            score: null,
            questions: [
              {
                number: 1,
                description: "题干",
                score: null,
                subquestions: [],
                materials: [{ page: 1, x: 0, y: 0, width: 0.5, height: 0.5 }],
              },
            ],
          },
        ],
      };
      await onProgress!(exam);
      await expect(tools!.python.execute!(rotate, options)).rejects.toMatchObject({
        code: "PAGE_ALREADY_USED",
      });
      return exam;
    };
    await parseExam({ files: [path], outputDir: join(root, "result"), model: { generate } });
    const crop = await sharp(join(root, "result/materials/1-1.jpg")).metadata();
    expect(crop).toMatchObject({ width: 100, height: 50 });
    const colors = await sharp(join(root, "result/materials/1-1.jpg")).stats();
    expect(colors.channels[0].mean).toBeGreaterThan(240);
    expect(colors.channels[2].mean).toBeLessThan(15);
  });
});
