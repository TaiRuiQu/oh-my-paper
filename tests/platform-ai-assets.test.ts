import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  loadState: vi.fn(),
  requireSession: vi.fn(),
  run: vi.fn(),
  storagePaths: { storage: "", temp: "" },
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    platformAsset: { create: mocked.create, findUnique: mocked.findUnique },
    aiJob: { findMany: async () => [] },
  }),
}));
vi.mock("@/server/platform/service", () => ({ loadState: mocked.loadState }));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => mocked.storagePaths }));
vi.mock("@/server/auth/session", () => ({ requireSession: mocked.requireSession }));
vi.mock("@/server/logger", () => ({
  logError: () => ({ message: "error", errorId: "test", code: "TEST" }),
}));
vi.mock("@/server/ai/sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/sandbox")>()),
  createSandboxSession: () => ({ run: mocked.run, dispose: async () => {} }),
}));
import { createTaskSandbox } from "@/server/platform/ai/sandbox-tools";
import { GET } from "@/app/api/platform/assets/[id]/route";
import { AccessError } from "@/server/http/errors";

const assets = new Map<string, Record<string, unknown>>();
const sandboxes: ReturnType<typeof createTaskSandbox>[] = [];
let png: Buffer;
beforeEach(async () => {
  vi.clearAllMocks();
  assets.clear();
  mocked.storagePaths.storage = await mkdtemp(join(tmpdir(), "omp-trace-assets-"));
  mocked.storagePaths.temp = join(mocked.storagePaths.storage, "tmp");
  png = await sharp({ create: { width: 20, height: 30, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  mocked.create.mockImplementation(async ({ data }) => {
    assets.set(data.id, data);
    return data;
  });
  mocked.findUnique.mockImplementation(async ({ where }) => assets.get(where.id) ?? null);
  mocked.requireSession.mockResolvedValue({ user: { id: "teacher" } });
  mocked.loadState.mockImplementation(async ({ id }) => ({
    actor: { id, role: "TEACHER" },
    submissions: [],
    papers: [],
    questions: [],
    analytics: { students: [] },
  }));
  mocked.run.mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
    images: [{ name: "preview.png", data: png.toString("base64") }],
  });
});
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.dispose()));
  await rm(mocked.storagePaths.storage, { recursive: true, force: true });
});

async function exportImage(tool: "python" | "shell" = "python") {
  const onImages = vi.fn(async () => {});
  const sandbox = createTaskSandbox({
    userId: "teacher",
    context: { task: "IMPORT" },
    allowedAssets: new Set(),
    readAsset: async () => png,
    onImages,
    ensureOpen: () => {},
  });
  sandboxes.push(sandbox);
  const input = { code: "print('image')", command: "true", assets: [], images: ["preview.png"] };
  const output = await sandbox.tools[tool].execute!(input, {
    toolCallId: "call",
    messages: [],
    context: {},
  });
  if (!("images" in output)) throw new Error("Expected a single sandbox result");
  return { sandbox, output, onImages };
}
const requestImage = (url: string) =>
  GET(new Request(`https://paper.invalid${url}`), {
    params: Promise.resolve({ id: url.split("/").at(-1)! }),
  });

it.each(["python", "shell"] as const)(
  "serves %s trace pixels before business commit and after sandbox disposal",
  async (tool) => {
    const { sandbox, output, onImages } = await exportImage(tool);
    const image = output.images[0];
    expect(onImages).toHaveBeenCalledWith(
      [expect.objectContaining({ url: image.url, buffer: expect.any(Buffer) })],
      [],
    );
    expect(assets.size).toBe(1);
    const row = assets.get(image.url.split("/").at(-1)!)!;
    expect(row.ownerId).toBe("teacher");
    expect(await readFile(String(row.path))).toEqual(png);
    const running = await requestImage(image.url);
    expect(running.status).toBe(200);
    expect(running.headers.get("content-type")).toBe("image/png");
    expect(running.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await running.arrayBuffer())).toEqual(png);
    await sandbox.dispose();
    sandboxes.splice(sandboxes.indexOf(sandbox), 1);
    expect((await requestImage(image.url)).status).toBe(200);
    mocked.requireSession.mockResolvedValueOnce({ user: { id: "another-teacher" } });
    expect((await requestImage(image.url)).status).toBe(404);
    mocked.requireSession.mockRejectedValueOnce(new AccessError(401, "请先登录。"));
    expect((await requestImage(image.url)).status).toBe(401);
  },
);
it("retains output images for inspection when a command fails", async () => {
  mocked.run.mockResolvedValueOnce({
    exitCode: 1,
    stdout: "",
    stderr: "calculation failed",
    images: [{ name: "preview.png", data: png.toString("base64") }],
  });
  const { output, onImages } = await exportImage();
  expect(output.exitCode).toBe(1);
  expect(onImages).not.toHaveBeenCalled();
  expect((await requestImage(output.images[0].url)).status).toBe(200);
});
it("does not publish a URL or leave a file when asset persistence fails", async () => {
  mocked.create.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(exportImage()).rejects.toThrow("database unavailable");
  expect(assets.size).toBe(0);
  expect(await readdir(join(mocked.storagePaths.storage, "platform-assets"))).toEqual([]);
});
