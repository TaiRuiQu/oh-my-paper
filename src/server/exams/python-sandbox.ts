import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { PageImage } from "./documents";
import { AppError } from "@/server/errors";

const execute = promisify(execFile);
const imageName = z.string().regex(/^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/);
export const pythonInputSchema = z.strictObject({
  code: z.string().min(1).max(60_000),
  images: z.array(imageName).max(3),
  replacePages: z
    .array(z.strictObject({ page: z.number().int().positive(), image: imageName }))
    .max(3),
});
export type PythonInput = z.infer<typeof pythonInputSchema>;
const outputSchema = z.strictObject({
  exitCode: z.number().int(),
  stdout: z.string().max(32_000),
  stderr: z.string().max(32_000),
  images: z
    .array(z.strictObject({ name: imageName, data: z.string().max(12 * 1024 * 1024) }))
    .max(3),
});

export async function runSandboxPython(options: {
  code: string;
  images: string[];
  pages: PageImage[];
  directory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  options.signal?.throwIfAborted();
  if (process.platform !== "linux")
    throw new AppError(
      "本地 Python 沙箱需要 Linux 和 Bubblewrap。",
      "PYTHON_SANDBOX_UNAVAILABLE",
      503,
    );
  const temporaryRoot = join(options.directory, ".python");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(temporaryRoot, "run-"));
  try {
    const request = join(temporary, "request.json");
    await writeFile(request, JSON.stringify({ code: options.code, images: options.images }), {
      mode: 0o600,
    });
    const args = [
      "--unshare-all",
      "--unshare-user",
      "--disable-userns",
      "--die-with-parent",
      "--new-session",
      "--uid",
      "65534",
      "--gid",
      "65534",
      "--cap-drop",
      "ALL",
      "--ro-bind",
      "/usr",
      "/usr",
      "--symlink",
      "usr/bin",
      "/bin",
      "--symlink",
      "usr/lib",
      "/lib",
      "--symlink",
      "usr/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--size",
      "67108864",
      "--tmpfs",
      "/tmp",
      "--size",
      "134217728",
      "--tmpfs",
      "/workspace",
      "--dir",
      "/workspace/pages",
      "--dir",
      "/runtime",
      "--ro-bind",
      resolve("tools/python/run.py"),
      "/runtime/run.py",
      "--ro-bind",
      resolve(request),
      "/runtime/request.json",
      "--ro-bind",
      resolve(options.directory, "agent"),
      "/workspace/agent",
      "--clearenv",
      "--setenv",
      "PATH",
      "/usr/bin:/bin",
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--chdir",
      "/workspace",
    ];
    for (const page of options.pages)
      args.push(
        "--ro-bind",
        resolve(page.path),
        `/workspace/pages/${String(page.page).padStart(3, "0")}.jpg`,
      );
    // Only the Python environment is mounted, never the project or its secrets.
    const pythonEnvironment = resolve(process.env.PYTHON_SANDBOX_VENV ?? ".venv");
    const hasEnvironment = await access(join(pythonEnvironment, "bin/python3")).then(
      () => true,
      () => false,
    );
    if (process.env.PYTHON_SANDBOX_VENV && !hasEnvironment)
      throw new AppError(
        "PYTHON_SANDBOX_VENV 未指向有效的 Python 虚拟环境。",
        "PYTHON_SANDBOX_UNAVAILABLE",
        503,
      );
    if (hasEnvironment) args.push("--ro-bind", pythonEnvironment, "/python");
    args.push(
      "/usr/bin/prlimit",
      "--as=536870912",
      "--cpu=30",
      "--nproc=64",
      "--nofile=64",
      "--fsize=16777216",
      "--core=0",
      "--",
      hasEnvironment ? "/python/bin/python3" : "/usr/bin/python3",
      "-I",
      "/runtime/run.py",
    );
    let stdout: string;
    try {
      ({ stdout } = await execute(process.env.BWRAP_PATH ?? "bwrap", args, {
        signal: options.signal,
        timeout: options.timeoutMs ?? 60_000,
        killSignal: "SIGKILL",
        maxBuffer: 36 * 1024 * 1024,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" },
        encoding: "utf8",
      }));
    } catch (cause) {
      options.signal?.throwIfAborted();
      throw new AppError(
        "Python 沙箱运行失败或超时。请检查 Bubblewrap、Pillow 和系统用户命名空间支持。",
        "PYTHON_SANDBOX_FAILED",
        422,
        { cause },
      );
    }
    return outputSchema.parse(JSON.parse(stdout));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
