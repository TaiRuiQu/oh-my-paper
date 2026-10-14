import { mkdtemp, mkdir, chmod, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createInspectionTools, disposeInspectionTools } from "@/server/exams/tools";
import {
  commandInputSchema,
  pythonInputSchema,
  runSandboxPython,
  runSandboxCommand,
  createSandboxSession,
} from "@/server/exams/python-sandbox";
import { parseExam } from "@/server/exams/parser";
import { AppError } from "@/server/errors";
import type { ExamModel } from "@/server/ai/providers";

const roots: string[] = [];
const activeTools: object[] = [];
function inspection(...args: Parameters<typeof createInspectionTools>) {
  const tools = createInspectionTools(...args);
  activeTools.push(tools);
  return tools;
}
const options = { toolCallId: "python", messages: [], context: {} };
afterEach(async () => {
  await Promise.all(activeTools.splice(0).map(disposeInspectionTools));
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
  code: 'from PIL import Image\nim = Image.open("pages/001.jpg")\nrotated = im.rotate(90, expand=True)\nrotated.save("pages/001.jpg")\nrotated.save("output/rotated.png")\nprint("rotated", im.size)',
  images: ["rotated.png"],
};

describe("local Python sandbox", () => {
  it("computes numerical and symbolic answers with the preinstalled libraries inside the sandbox", async () => {
    const { root, pages } = await fixture();
    const tools = inspection(pages, root);
    const result = await tools.python.execute!(
      {
        code: 'import numpy as np, sympy as sp, mpmath as mp\nfrom scipy.integrate import quad\nprint(np.linalg.solve([[2, 1], [1, 2]], [3, 3]).tolist())\nprint(round(quad(lambda x: x*x, 0, 1)[0], 6))\nx=sp.symbols("x")\nprint(sp.solve(x*x-4, x))\nprint(mp.almosteq(mp.sqrt(2)**2, 2))',
        images: [],
      },
      options,
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "", images: [] });
    expect(result.stdout).toBe("[1.0, 1.0]\n0.333333\n[-2, 2]\nTrue\n");
  });
  it("automatically imports pages overwritten directly by shell/Python without export or replacement metadata", async () => {
    const { root, pages, path } = await fixture();
    const original = await readFile(path);
    let lockedPage = false;
    const tools = inspection(pages, root, undefined, (numbers) => {
      if (lockedPage && numbers.length) throw new AppError("used", "PAGE_ALREADY_USED", 422);
    });
    const result = await tools.shell.execute!(
      {
        command: `python3 -c 'from PIL import Image; im=Image.open("pages/001.jpg"); im.rotate(90, expand=True).save("pages/001.jpg")'`,
        images: [],
      },
      options,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      images: [],
      pages: [{ page: 1, width: 200, height: 100 }],
    });
    expect(pages[0]).toMatchObject({ width: 200, height: 100 });
    expect(
      await tools.python.execute!(
        {
          code: 'from PIL import Image\nprint(Image.open("pages/001.jpg").size)',
          images: [],
        },
        options,
      ),
    ).toMatchObject({ stdout: "(200, 100)\n" });
    expect(await readFile(path)).toEqual(original);
    lockedPage = true;
    await expect(
      tools.shell.execute!(
        {
          command: `python3 -c 'from PIL import Image; im=Image.open("pages/001.jpg"); im.rotate(90, expand=True).save("pages/001.jpg")'`,
          images: [],
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "PYTHON_SANDBOX_FAILED" });
    expect(pages[0]).toMatchObject({ width: 200, height: 100 });
    expect(
      await tools.python.execute!(
        {
          code: 'from PIL import Image\nprint(Image.open("pages/001.jpg").size)',
          images: [],
        },
        options,
      ),
    ).toMatchObject({ stdout: "(200, 100)\n" });
  });
  it("shares a 100 MiB filesystem across Python and shell for the entire agent, even after a timeout", async () => {
    const { root, pages } = await fixture();
    const session = createSandboxSession({ directory: root, pages });
    try {
      expect(
        await session.run({
          code: 'import os\ns=os.statvfs(".")\nassert s.f_blocks*s.f_frsize == 100*1024*1024\nopen("state.txt", "w").write("persisted")',
          images: [],
        }),
      ).toMatchObject({ exitCode: 0 });
      expect(
        await session.run({ command: "cat state.txt; printf updated > state.txt", images: [] }),
      ).toMatchObject({ stdout: "persisted", exitCode: 0 });
      await expect(
        session.run({ command: "sleep 30", images: [] }, { timeoutMs: 150 }),
      ).rejects.toMatchObject({ code: "PYTHON_SANDBOX_FAILED" });
      expect(
        await session.run({ code: 'print(open("state.txt").read())', images: [] }),
      ).toMatchObject({ stdout: "updated\n", exitCode: 0 });
      const results = await Promise.all([
        session.run({ command: "printf one > one.txt", images: [] }),
        session.run({ command: "cat one.txt", images: [] }),
      ]);
      expect(results[1].stdout).toBe("one");
      await expect(
        session.run({
          command:
            "for i in 1 2 3 4 5 6 7 8; do dd if=/dev/zero of=file-$i bs=1M count=14 2>/dev/null || exit 9; done",
          images: [],
        }),
      ).rejects.toMatchObject({ code: "PYTHON_SANDBOX_FAILED" });
      expect(
        await session.run({ command: "rm -f file-*; cat state.txt", images: [] }),
      ).toMatchObject({ exitCode: 0, stdout: "updated" });
    } finally {
      await session.dispose();
    }
    const fresh = createSandboxSession({ directory: root, pages });
    try {
      expect(await fresh.run({ command: "test ! -f state.txt", images: [] })).toMatchObject({
        exitCode: 0,
      });
    } finally {
      await fresh.dispose();
    }
  });
  it("respawns the sandbox after the process dies and announces the workspace reset", async () => {
    const { root, pages } = await fixture();
    // A stub bwrap reproduces a sandbox that dies at spawn (the production
    // failure mode), then one that answers a single request before exiting.
    const stub = join(root, "stub-bwrap");
    await writeFile(stub, "#!/bin/sh\nexit 1\n");
    await chmod(stub, 0o755);
    vi.stubEnv("BWRAP_PATH", stub);
    const session = createSandboxSession({ directory: root, pages });
    try {
      await expect(session.run({ command: "printf kept", images: [] })).rejects.toMatchObject({
        code: "PYTHON_SANDBOX_FAILED",
        message: expect.stringMatching(/沙箱进程退出（1）|沙箱输入通道错误：write EPIPE/),
      });
      await writeFile(
        stub,
        `#!/bin/sh
read line
printf '%s\\n' '{"result":{"exitCode":0,"stdout":"ok","stderr":"","images":[]}}'
`,
      );
      const result = await session.run({ command: "printf kept", images: [] });
      expect(result.stdout).toContain("沙箱进程已重启");
      expect(result.stdout).toContain("ok");
      await expect(session.run({ command: "printf kept", images: [] })).rejects.toMatchObject({
        code: "PYTHON_SANDBOX_FAILED",
      });
    } finally {
      await session.dispose();
    }
  });
  it("repeatedly exports images and reads the previous call's updated page", async () => {
    const { root, pages } = await fixture();
    const tools = inspection(pages, root);
    for (let call = 0; call < 5; call++) {
      const result = await tools.python.execute!(rotate, options);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const followup = await tools.python.execute!(
        {
          code: 'import os\nfrom PIL import Image\nassert os.environ["OPENBLAS_NUM_THREADS"] == "1"\nassert os.environ["OPENCV_FOR_THREADS_NUM"] == "1"\nprint(Image.open("pages/001.jpg").size)',
          images: [],
        },
        options,
      );
      expect(followup).toMatchObject({
        exitCode: 0,
        stdout: call % 2 ? "(100, 200)\n" : "(200, 100)\n",
      });
    }
    expect(await readdir(join(root, ".python"))).toEqual([]);
  }, 15_000);
  it("runs arbitrary shell commands with the same isolation, exports and recovery", async () => {
    const { root, pages } = await fixture();
    const tools = inspection(pages, root);
    const result = await tools.shell.execute!(
      {
        command: `python3 -c '${rotate.code.replaceAll("\n", ";")}'`,
        images: rotate.images,
      },
      options,
    );
    if (!("images" in result)) throw new Error("Expected a completed shell result");
    expect(result).toMatchObject({ exitCode: 0, pages: [{ width: 200, height: 100 }] });
    expect(
      await tools.shell.toModelOutput!({
        toolCallId: "shell",
        input: { command: "", images: [] },
        output: result,
      }),
    ).toMatchObject({ type: "content", value: [{ type: "text" }, { type: "file" }] });
    const run = (command: string, timeoutMs?: number) =>
      runSandboxCommand({ command, images: [], pages, directory: root, timeoutMs });
    expect(
      await run(
        `test ! -e ${JSON.stringify(join(root, "host-secret"))}; test ! -e /home/xiaoq/Documents/oh-my-paper/.env; test "$(id -u)" = 65534; printf ok`,
      ),
    ).toMatchObject({ exitCode: 0, stdout: "ok" });
    expect(await run("echo forbidden > /runtime/run.py")).toMatchObject({ exitCode: 2 });
    expect(await run("printf problem >&2; exit 7")).toMatchObject({
      exitCode: 7,
      stderr: "problem",
    });
    await expect(run("sleep 30 & wait", 150)).rejects.toMatchObject({
      code: "PYTHON_SANDBOX_FAILED",
    });
    expect(await run("printf recovered")).toMatchObject({ exitCode: 0, stdout: "recovered" });
    expect(await readdir(join(root, ".python"))).toEqual([]);
  }, 15_000);
  it("executes arbitrary Python with Pillow while hiding host files, secrets and network", async () => {
    const { root, pages } = await fixture();
    const secretFile = join(root, "host-secret.txt");
    await writeFile(secretFile, "host secret");
    vi.stubEnv("PYTHON_SANDBOX_TEST_SECRET", "secret env");
    const result = await runSandboxPython({
      pages,
      directory: root,
      images: [],
      code: `import os, socket\nfrom PIL import Image\nassert os.getuid() == 65534\nassert "PYTHON_SANDBOX_TEST_SECRET" not in os.environ\nassert not os.path.exists(${JSON.stringify(secretFile)})\nassert not os.path.exists("/home/xiaoq/Documents/oh-my-paper/.env")\ntry:\n    open("/runtime/run.py", "wb")\n    raise AssertionError("source was writable")\nexcept OSError:\n    pass\ns = socket.socket()\ns.settimeout(0.1)\ntry:\n    s.connect(("1.1.1.1", 80))\n    raise AssertionError("network was available")\nexcept OSError:\n    pass\nprint(sum(i*i for i in range(10)))\nprint(Image.open("pages/001.jpg").size)`,
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "", images: [] });
    expect(result.stdout).toContain("285\n(100, 200)");
    expect(await readdir(join(root, ".python"))).toEqual([]);
  });
  it("returns rotated images to the model and uses the corrected page for later calls", async () => {
    const { root, pages, path } = await fixture();
    const source = await readFile(path);
    const tools = inspection(pages, root);
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
    expect(await readFile(path)).toEqual(source);
  });
  it("keeps preview-only processing from changing the page, and reports Python exceptions", async () => {
    const { root, pages, path } = await fixture();
    const tools = inspection(pages, root);
    const preview = await tools.python.execute!(
      {
        code: 'from PIL import Image\nImage.open("pages/001.jpg").rotate(90, expand=True).save("output/rotated.png")',
        images: ["rotated.png"],
      },
      options,
    );
    if (!("images" in preview)) throw new Error("Expected a completed Python result");
    expect(preview.images).toHaveLength(1);
    expect(pages[0]).toMatchObject({ width: 100, height: 200, path });
    const failure = await tools.python.execute!(
      { code: 'raise ValueError("bad angle")', images: [] },
      options,
    );
    if (!("stderr" in failure)) throw new Error("Expected a completed Python result");
    expect(failure).toMatchObject({ exitCode: 1, images: [], pages: [] });
    expect(failure.stderr).toContain("ValueError: bad angle");
    expect(pages[0].path).toBe(path);
  });
  it("rejects invalid export filenames and removed page replacement parameters", () => {
    for (const name of ["../secret.png", "/tmp/image.png", "x.py", "x.png/../../secret"])
      expect(pythonInputSchema.safeParse({ code: "print(1)", images: [name] }).success).toBe(false);
    expect(pythonInputSchema.parse({ code: "print(1)" })).toEqual({
      code: "print(1)",
      images: [],
    });
    expect(commandInputSchema.parse({ command: "true" })).toEqual({
      command: "true",
      images: [],
    });
    expect(pythonInputSchema.safeParse({ ...rotate, replacePages: [] }).success).toBe(false);
    expect(commandInputSchema.safeParse({ command: "true", replacePages: [] }).success).toBe(false);
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
    expect(
      await runSandboxPython({ code: 'print("recovered")', images: [], pages, directory: root }),
    ).toMatchObject({ exitCode: 0, stdout: "recovered\n" });
    vi.stubEnv("BWRAP_PATH", "/nonexistent/bwrap");
    await expect(
      runSandboxPython({ code: "print(1)", images: [], pages, directory: root }),
    ).rejects.toMatchObject({ code: "PYTHON_SANDBOX_FAILED" });
  });
  it("honors the SDK tool cancellation signal and removes the temporary request", async () => {
    const { root, pages } = await fixture();
    const tools = inspection(pages, root);
    await expect(
      tools.python.execute!(
        { code: "while True: pass", images: [] },
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
        code: "PYTHON_SANDBOX_FAILED",
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
