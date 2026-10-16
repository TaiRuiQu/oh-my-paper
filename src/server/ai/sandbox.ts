import "server-only";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AppError } from "@/server/errors";

export const sandboxImageNameSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.(?:png|jpe?g|webp)$/);
export const sandboxPdfNameSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.pdf$/);
export const sandboxInputSchema = z.union([
  z.strictObject({
    code: z.string().min(1).max(60000),
    images: z.array(sandboxImageNameSchema).max(3).default([]),
    files: z.array(sandboxPdfNameSchema).max(3).default([]),
  }),
  z.strictObject({
    command: z.string().min(1).max(60000),
    images: z.array(sandboxImageNameSchema).max(3).default([]),
    files: z.array(sandboxPdfNameSchema).max(3).default([]),
  }),
]);
export type SandboxInput = z.input<typeof sandboxInputSchema>;
const outputSchema = z.strictObject({
  exitCode: z.number().int(),
  stdout: z.string().max(32000),
  stderr: z.string().max(32000),
  images: z
    .array(z.strictObject({ name: sandboxImageNameSchema, data: z.string().max(12 * 1024 * 1024) }))
    .max(3),
  files: z
    .array(z.strictObject({ name: sandboxPdfNameSchema, data: z.string().max(12 * 1024 * 1024) }))
    .max(3),
});
export type SandboxOutput = z.infer<typeof outputSchema>;
const failure = (message: string) => new AppError(message, "AI_SANDBOX_FAILED", 422);

export function sandboxRemediation(diagnostic: string): string {
  if (
    /RTM_NEWADDR|uid map|creating new user namespace|new user namespaces|No permissions to create new namespace|non-privileged user namespaces/i.test(
      diagnostic,
    )
  )
    return "沙箱无法创建用户命名空间。请在服务器执行 sudo python3 deploy/repair-sandbox.py，检查并修复 Worker 的 Docker 安全配置及宿主机用户命名空间策略；详见 docs/deployment.zh-CN.md。";
  if (/Can't mount proc/i.test(diagnostic))
    return "Worker 的系统路径屏蔽阻止了私有 /proc 挂载。请检查 compose.yaml 中 seccomp、AppArmor 与 systempaths=unconfined 配置，并重建 Worker。";
  if (/Can't mount|Operation not permitted|EPERM/i.test(diagnostic))
    return "宿主机或容器拒绝沙箱挂载。请检查 Worker 的 Bubblewrap、用户命名空间、seccomp 与 AppArmor 配置。";
  if (/ENOENT|not found/i.test(diagnostic))
    return "缺少沙箱运行依赖。请安装 Bubblewrap、Python 与 tools/sandbox/requirements.txt，或设置 BWRAP_PATH 和 PYTHON_SANDBOX_VENV。";
  return "";
}

const processEnvironment: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "C.UTF-8",
  NODE_ENV: "production",
};
function baseArguments() {
  return [
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
    "/python/bin:/usr/bin:/bin",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "HOME",
    "/workspace",
    "--chdir",
    "/workspace",
    ...[
      "OPENBLAS_NUM_THREADS",
      "OMP_NUM_THREADS",
      "MKL_NUM_THREADS",
      "NUMEXPR_NUM_THREADS",
      "BLIS_NUM_THREADS",
      "OPENCV_FOR_THREADS_NUM",
    ].flatMap((name) => ["--setenv", name, "1"]),
  ];
}

export function verifySandboxEnvironment(): {
  ok: boolean;
  diagnostic: string;
  remediation: string;
} {
  if (process.platform !== "linux")
    return { ok: false, diagnostic: "AI 沙箱需要 Linux 和 Bubblewrap。", remediation: "" };
  const result = spawnSync(
    process.env.BWRAP_PATH ?? "bwrap",
    [
      ...baseArguments(),
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
    { timeout: 15000, env: processEnvironment },
  );
  const diagnostic = [
    result.error?.message,
    result.stderr?.toString(),
    result.status === null ? "" : `退出码 ${result.status}`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return { ok: result.status === 0, diagnostic, remediation: sandboxRemediation(diagnostic) };
}

export function assertSandboxEnvironment() {
  const environment = verifySandboxEnvironment();
  if (!environment.ok)
    throw failure(
      `AI 沙箱启动检查失败。${environment.diagnostic} ${environment.remediation}`.trim(),
    );
}

/** A task gets a private persistent filesystem; every invocation gets fresh bounded processes. */
export function createSandboxSession(options: { directory: string; signal?: AbortSignal }) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let closed = false;
  let crashed = false;
  let exited = Promise.resolve();
  let settleExited = () => {};
  let pending = Promise.resolve();
  let buffer = "",
    diagnostic = "";
  let receiver: { resolve: (value: unknown) => void; reject: (error: unknown) => void } | undefined;
  async function stop() {
    if (stopping) return stopping;
    const current = child;
    if (!current || current.exitCode !== null || current.signalCode !== null) return;
    stopping = (async () => {
      current.kill("SIGKILL");
      await exited;
    })();
    try {
      await stopping;
    } finally {
      stopping = undefined;
    }
  }
  async function start() {
    options.signal?.throwIfAborted();
    if (closed) throw failure("任务沙箱已关闭。");
    if (process.platform !== "linux") throw failure("AI 沙箱需要 Linux 和 Bubblewrap。");
    const inputs = resolve(options.directory, "inputs");
    await mkdir(inputs, { recursive: true, mode: 0o700 });
    if ((await realpath(inputs)) !== inputs) throw failure("沙箱输入目录不能是符号链接。");
    const args = [
      ...baseArguments(),
      "--ro-bind",
      inputs,
      "/inputs",
      "--dir",
      "/runtime",
      "--ro-bind",
      resolve("tools/sandbox/session.py"),
      "/runtime/session.py",
      "--ro-bind",
      resolve("tools/sandbox/run.py"),
      "/runtime/run.py",
    ];
    const environment = resolve(process.env.PYTHON_SANDBOX_VENV ?? ".venv");
    const hasEnvironment = await access(join(environment, "bin/python3")).then(
      () => true,
      () => false,
    );
    if (process.env.PYTHON_SANDBOX_VENV && !hasEnvironment)
      throw failure("PYTHON_SANDBOX_VENV 未指向有效的 Python 虚拟环境。");
    if (hasEnvironment) args.push("--ro-bind", environment, "/python");
    args.push(
      "--remount-ro",
      "/dev",
      "--remount-ro",
      "/",
      "--",
      hasEnvironment ? "/python/bin/python3" : "/usr/bin/python3",
      "-I",
      "/runtime/session.py",
    );
    child = spawn(process.env.BWRAP_PATH ?? "bwrap", args, {
      env: processEnvironment,
      stdio: "pipe",
    });
    buffer = "";
    diagnostic = "";
    exited = new Promise<void>((resolveExit) => {
      settleExited = resolveExit;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 36 * 1024 * 1024) {
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
      } catch {
        receiver?.reject(failure("沙箱返回的数据无效。"));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      diagnostic = (diagnostic + chunk).slice(-4000);
    });
    child.stdin.on("error", (error) => {
      // Wait for close to drain stderr; EPIPE often races with bwrap's actual error.
      diagnostic = (diagnostic + `\n沙箱输入通道错误：${error.message}`).slice(-4000);
      void stop();
    });
    child.on("error", (error) => {
      diagnostic = error.message;
      receiver?.reject(failure(`${error.message} ${sandboxRemediation(error.message)}`));
    });
    child.on("close", (code, signal) => {
      settleExited();
      starting = undefined;
      if (!closed) crashed = true;
      receiver?.reject(
        failure(
          `沙箱进程退出（${code ?? signal}）。${diagnostic} ${sandboxRemediation(diagnostic)}`.trim(),
        ),
      );
    });
  }
  async function dispose() {
    closed = true;
    options.signal?.removeEventListener("abort", abortSession);
    await starting?.catch(() => {});
    await stop();
  }
  function abortSession() {
    receiver?.reject(options.signal?.reason ?? failure("沙箱任务已取消。"));
    void dispose();
  }
  options.signal?.addEventListener("abort", abortSession, { once: true });
  return {
    dispose,
    run(
      input: SandboxInput,
      runOptions: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<SandboxOutput> {
      const parsed = sandboxInputSchema.parse(input);
      const timeoutMs = runOptions.timeoutMs ?? 60000;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
        return Promise.reject(failure("沙箱超时应在 1–60000 毫秒之间。"));
      const next = pending.then(async () => {
        runOptions.signal?.throwIfAborted();
        options.signal?.throwIfAborted();
        if (closed) throw failure("任务沙箱已关闭。");
        await stopping;
        if (!starting && child) await exited;
        const announceReset = crashed;
        crashed = false;
        starting ??= start().catch((error) => {
          starting = undefined;
          throw error;
        });
        await starting;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
          receiver?.reject(runOptions.signal?.reason ?? failure("本次沙箱调用已取消。"));
          void stop();
        };
        try {
          const response = await new Promise<unknown>((resolveResponse, reject) => {
            receiver = { resolve: resolveResponse, reject };
            runOptions.signal?.addEventListener("abort", abort, { once: true });
            if (runOptions.signal?.aborted) {
              abort();
              return;
            }
            timer = setTimeout(() => {
              reject(failure("沙箱未响应，进程已终止。"));
              void stop();
            }, timeoutMs + 5000);
            child!.stdin.write(JSON.stringify({ ...parsed, timeoutMs }) + "\n");
          });
          const envelope = z
            .strictObject({ failure: z.string().optional(), result: outputSchema.optional() })
            .parse(response);
          if (envelope.failure !== undefined) throw failure(envelope.failure);
          if (!envelope.result) throw failure("沙箱返回的数据无效。");
          if (announceReset)
            envelope.result.stdout =
              `[沙箱进程已重启，/workspace 中先前的文件已丢失]\n${envelope.result.stdout}`.slice(
                0,
                32000,
              );
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
