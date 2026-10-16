import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { assertSandboxEnvironment, createSandboxSession } from "@/server/ai/sandbox";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(), spawnSync: vi.fn() };
});
afterEach(() => vi.resetAllMocks());

const namespaceError =
  "bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces";

it("rejects an unavailable sandbox during the worker startup check", () => {
  vi.mocked(spawnSync).mockReturnValue({
    status: 1,
    stderr: Buffer.from(namespaceError),
    stdout: Buffer.alloc(0),
    pid: 1,
    signal: null,
    output: [],
  });
  expect(assertSandboxEnvironment).toThrow(
    /AI 沙箱启动检查失败.*No permissions.*repair-sandbox.py/,
  );
  expect(spawn).not.toHaveBeenCalled();
});

it("keeps the bwrap diagnosis when stdin fails before stderr is drained", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omp-sandbox-failure-"));
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => {
      // ChildProcess emits close after its streams have delivered buffered data.
      queueMicrotask(() => {
        stderr.write(namespaceError);
        child.exitCode = 1;
        child.emit("close", 1, null);
      });
      return true;
    }),
  });
  stdin.once("data", () => stdin.emit("error", new Error("write EPIPE")));
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const session = createSandboxSession({ directory });
  try {
    await expect(session.run({ command: "pwd" })).rejects.toThrow(
      /write EPIPE.*No permissions.*repair-sandbox.py/s,
    );
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  } finally {
    await session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
