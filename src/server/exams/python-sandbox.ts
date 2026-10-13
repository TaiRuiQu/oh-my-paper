import "server-only";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { z } from "zod";
import type { PageImage } from "./documents";
import { AppError } from "@/server/errors";

const imageName = z.string().regex(/^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/);
export const pythonInputSchema = z.strictObject({
  code: z.string().min(1).max(60_000),
  images: z.array(imageName).max(3).default([]),
  replacePages: z
    .array(z.strictObject({ page: z.number().int().positive(), image: imageName }))
    .max(3)
    .default([])
    .describe(
      "Legacy page replacement. Prefer overwriting /workspace/pages/001.jpg directly; omit this field.",
    ),
});
export type PythonInput = z.infer<typeof pythonInputSchema>;
export const commandInputSchema = pythonInputSchema.omit({ code: true }).extend({
  command: z.string().min(1).max(60_000),
});
const pageUpdateSchema = z.strictObject({
  page: z.number().int().positive(),
  data: z.string().max(12 * 1024 * 1024),
});
const outputSchema = z.strictObject({
  exitCode: z.number().int(),
  stdout: z.string().max(32_000),
  stderr: z.string().max(32_000),
  images: z
    .array(z.strictObject({ name: imageName, data: z.string().max(12 * 1024 * 1024) }))
    .max(3),
  pageUpdates: z.array(pageUpdateSchema).optional(),
});

type SandboxOptions = {
  images: string[];
  pages: PageImage[];
  directory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};
type RequestInput = { code: string; images: string[] } | { command: string; images: string[] };
export async function runSandboxPython(options: SandboxOptions & { code: string }) {
  const session = createSandboxSession(options);
  try {
    return await session.run({ code: options.code, images: options.images }, options);
  } finally {
    await session.dispose();
  }
}
export async function runSandboxCommand(options: SandboxOptions & { command: string }) {
  const session = createSandboxSession(options);
  try {
    return await session.run({ command: options.command, images: options.images }, options);
  } finally {
    await session.dispose();
  }
}

// Known bwrap failure signatures map to the operator action that resolves them.
// The text reaches the model (as tool failure text) and the structured logs.
export function sandboxRemediation(diagnostic: string): string {
  if (/RTM_NEWADDR|uid map|creating new user namespace|new user namespaces/i.test(diagnostic))
    return "宿主机内核限制非特权用户命名空间：在宿主机执行 sysctl kernel.apparmor_restrict_unprivileged_userns=0 并持久化（docs/deployment.zh-CN.md §8）。";
  if (/Can't mount proc/i.test(diagnostic))
    return "Docker 的默认系统路径屏蔽可能拒绝沙箱的私有 /proc 挂载：Worker 的 security_opt 需包含 seccomp:unconfined、apparmor:unconfined 和 systempaths=unconfined（使用等号）；修改 compose.yaml 后重建 Worker，并用 docker inspect 确认 HostConfig.MaskedPaths 与 HostConfig.ReadonlyPaths 均为 []。定时更新仅拉取镜像，不会同步 Compose 文件（docs/deployment.zh-CN.md §8）。";
  if (/Can't mount|Operation not permitted|EPERM/i.test(diagnostic))
    return "容器安全配置拒绝了沙箱挂载：Worker 容器需以 seccomp:unconfined 与 apparmor:unconfined 运行，用 docker inspect --format '{{json .HostConfig.SecurityOpt}}' 确认实际生效值（docs/deployment.zh-CN.md §8）。";
  if (/ENOENT/.test(diagnostic))
    return "沙箱缺少 bubblewrap 可执行文件：安装 bubblewrap 或设置 BWRAP_PATH。";
  return "";
}

// Boot-time smoke test replicating the real sandbox invocation as closely as
// possible: a user namespace with proc/dev/tmpfs mounts, dropped privileges and
// read-only root, i.e. exactly the layers container runtimes or host kernels
// may deny. A minimal bwrap call can pass while this full shape fails.
export function verifySandboxEnvironment(): {
  ok: boolean;
  diagnostic: string;
  remediation: string;
} {
  if (globalThis.process.platform !== "linux")
    return { ok: false, diagnostic: "本地沙箱需要 Linux 和 Bubblewrap。", remediation: "" };
  const result = spawnSync(
    globalThis.process.env.BWRAP_PATH ?? "bwrap",
    [
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
      "104857600",
      "--tmpfs",
      "/workspace",
      "--symlink",
      "/workspace/.tmp",
      "/tmp",
      "--clearenv",
      "--setenv",
      "PATH",
      "/usr/bin:/bin",
      "--chdir",
      "/workspace",
      "--remount-ro",
      "/dev",
      "--remount-ro",
      "/",
      "--",
      "/usr/bin/python3",
      "-I",
      "-c",
      "print('sandbox ok')",
    ],
    { timeout: 15_000, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" } },
  );
  const diagnostic = [
    result.error?.message ?? "",
    result.stderr?.toString() ?? "",
    result.status === null ? "" : `退出码 ${result.status}`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return { ok: result.status === 0, diagnostic, remediation: sandboxRemediation(diagnostic) };
}

export function createSandboxSession(options: {
  pages: PageImage[];
  directory: string;
  signal?: AbortSignal;
}) {
  const initialPages = options.pages.map((page) => ({ ...page }));
  let process: ChildProcessWithoutNullStreams | undefined;
  let starting: Promise<void> | undefined;
  let closed = false;
  // A dead sandbox process no longer poisons the whole agent run: the next
  // request respawns it and is told that /workspace was reset by the restart.
  let crashed = false;
  let announceReset = false;
  // Resolves once the current process has been reaped, so a respawn decision
  // never races the close event of a process that just died.
  let exited: Promise<void> = Promise.resolve();
  let settleExited: () => void = () => {};
  let pending = Promise.resolve();
  const refreshPages = new Set<number>();
  let buffer = "",
    diagnostic = "";
  let receiver: { resolve: (value: unknown) => void; reject: (error: unknown) => void } | undefined;
  const failure = (message: string) => new AppError(message, "PYTHON_SANDBOX_FAILED", 422);
  const start = async () => {
    options.signal?.throwIfAborted();
    if (closed) throw failure("沙箱已经关闭。");
    if (globalThis.process.platform !== "linux")
      throw failure("本地沙箱需要 Linux 和 Bubblewrap。");
    await mkdir(join(options.directory, ".python"), { recursive: true, mode: 0o700 });
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
      "104857600",
      "--tmpfs",
      "/workspace",
      "--symlink",
      "/workspace/.tmp",
      "/tmp",
      "--dir",
      "/inputs/pages",
      "--dir",
      "/runtime",
      "--ro-bind",
      resolve("tools/python/run.py"),
      "/runtime/run.py",
      "--ro-bind",
      resolve("tools/python/session.py"),
      "/runtime/session.py",
      "--ro-bind",
      resolve(options.directory, "agent"),
      "/inputs/agent",
      "--symlink",
      "/inputs/agent",
      "/workspace/agent",
      "--clearenv",
      "--setenv",
      "PATH",
      "/python/bin:/usr/bin:/bin",
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--chdir",
      "/workspace",
    ];
    // Numerical libraries otherwise size their thread pools from host CPU count.
    // Thread stacks can exhaust the sandbox address-space/process limits on import.
    for (const name of [
      "OPENBLAS_NUM_THREADS",
      "OMP_NUM_THREADS",
      "MKL_NUM_THREADS",
      "NUMEXPR_NUM_THREADS",
      "BLIS_NUM_THREADS",
      "OPENCV_FOR_THREADS_NUM",
    ])
      args.push("--setenv", name, "1");
    for (const page of initialPages)
      args.push(
        "--ro-bind",
        resolve(page.path),
        `/inputs/pages/${String(page.page).padStart(3, "0")}.jpg`,
      );
    // Only the Python environment is mounted, never the project or its secrets.
    const pythonEnvironment = resolve(globalThis.process.env.PYTHON_SANDBOX_VENV ?? ".venv");
    const hasEnvironment = await access(join(pythonEnvironment, "bin/python3")).then(
      () => true,
      () => false,
    );
    if (globalThis.process.env.PYTHON_SANDBOX_VENV && !hasEnvironment)
      throw new AppError(
        "PYTHON_SANDBOX_VENV 未指向有效的 Python 虚拟环境。",
        "PYTHON_SANDBOX_UNAVAILABLE",
        503,
      );
    if (hasEnvironment) args.push("--ro-bind", pythonEnvironment, "/python");
    // Only /workspace is writable; prevent /dev or the namespace root from
    // providing additional tmpfs capacity outside the 100 MiB quota.
    args.push("--remount-ro", "/dev", "--remount-ro", "/");
    args.push(
      hasEnvironment ? "/python/bin/python3" : "/usr/bin/python3",
      "-I",
      "/runtime/session.py",
    );

    process = spawn(globalThis.process.env.BWRAP_PATH ?? "bwrap", args, {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" },
      stdio: "pipe",
    });
    buffer = "";
    diagnostic = "";
    exited = new Promise<void>((resolve) => {
      settleExited = resolve;
    });
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 144 * 1024 * 1024) {
        receiver?.reject(failure("沙箱输出超过大小限制。"));
        void stop();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        receiver?.resolve(JSON.parse(line));
      } catch (error) {
        receiver?.reject(error);
      }
    });
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      diagnostic = (diagnostic + chunk).slice(-1000);
    });
    process.stdin.on("error", (error) => {
      receiver?.reject(failure(`沙箱输入通道错误：${error.message}`));
      receiver = undefined;
    });
    process.on("error", (error) => {
      settleExited();
      if (!closed) crashed = true;
      starting = undefined;
      receiver?.reject(failure(error.message));
      receiver = undefined;
    });
    process.on("close", (code, signal) => {
      settleExited();
      if (!closed) crashed = true;
      starting = undefined;
      const detail = diagnostic.trim();
      const remediation = sandboxRemediation(detail);
      receiver?.reject(
        failure(
          `沙箱进程退出（${code ?? signal}）。${detail ? ` ${detail}` : ""}${remediation ? ` ${remediation}` : ""}`.trim(),
        ),
      );
      receiver = undefined;
    });
  };
  const abortSession = () => {
    void dispose();
  };
  options.signal?.addEventListener("abort", abortSession, { once: true });
  // Kill the sandbox process while keeping the session restartable; only
  // dispose() closes it for good.
  async function stop() {
    const child = process;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("close", resolve);
      child.kill("SIGKILL");
    });
  }
  async function dispose() {
    closed = true;
    options.signal?.removeEventListener("abort", abortSession);
    if (starting) await starting.catch(() => {});
    await stop();
  }
  return {
    dispose,
    refreshPages(numbers: number[]) {
      numbers.forEach((page) => refreshPages.add(page));
    },
    run(
      input: RequestInput,
      runOptions: { signal?: AbortSignal; timeoutMs?: number; lockedPages?: number[] } = {},
    ) {
      const next = pending.then(async () => {
        runOptions.signal?.throwIfAborted();
        options.signal?.throwIfAborted();
        if (closed) throw failure("沙箱已经关闭。");
        // Let a process that died a moment ago finish reaping before deciding.
        if (!starting && process) await exited;
        if (!starting && crashed) {
          crashed = false;
          announceReset = true;
        }
        starting ??= start().catch((error) => {
          starting = undefined;
          throw error;
        });
        await starting;
        const timeoutMs = runOptions.timeoutMs ?? 60_000;
        const pageLinks = options.pages.map((page) => {
          const name = `${String(page.page).padStart(3, "0")}.jpg`;
          const source = initialPages.find((initial) => initial.page === page.page);
          const preview = relative(join(options.directory, "agent"), page.path);
          const target =
            source?.path === page.path ? `/inputs/pages/${name}` : `/inputs/agent/${preview}`;
          if (source?.path !== page.path && (preview.startsWith("..") || preview.startsWith("/")))
            throw failure("页面路径不属于本次沙箱。");
          return {
            name,
            target,
            page: page.page,
            refresh: refreshPages.delete(page.page),
            locked: runOptions.lockedPages?.includes(page.page) ?? false,
          };
        });
        const abort = () => {
          receiver?.reject(runOptions.signal?.reason);
          void stop();
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const response = await new Promise<unknown>((resolve, reject) => {
            receiver = { resolve, reject };
            runOptions.signal?.addEventListener("abort", abort, { once: true });
            if (runOptions.signal?.aborted) {
              abort();
              return;
            }
            timer = setTimeout(() => {
              reject(failure("沙箱未响应，进程已终止。"));
              void stop();
            }, timeoutMs + 5000);
            process!.stdin.write(JSON.stringify({ ...input, pages: pageLinks, timeoutMs }) + "\n");
          });
          const envelope = z
            .object({ failure: z.string().optional(), result: outputSchema.optional() })
            .parse(response);
          if (envelope.failure !== undefined) throw failure(envelope.failure);
          if (!envelope.result) throw failure("沙箱返回的数据无效。");
          if (announceReset) {
            announceReset = false;
            envelope.result.stdout = `[沙箱进程已重启，/workspace 已重置为初始页面，先前创建的文件已丢失]\n${envelope.result.stdout}`;
          }
          return envelope.result;
        } finally {
          clearTimeout(timer);
          receiver = undefined;
          runOptions.signal?.removeEventListener("abort", abort);
        }
      });
      pending = next.then(
        () => {},
        () => {},
      );
      return next;
    },
  };
}
