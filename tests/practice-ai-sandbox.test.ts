import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
const mock = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), paths: { temp: "", storage: "" } }));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => mock.paths }));
vi.mock("@/server/platform/assets", () => ({ saveImage: mock.save }));
vi.mock("@/server/ai/sandbox", async (original) => ({
  ...(await original<typeof import("@/server/ai/sandbox")>()),
  createSandboxSession: () => ({ run: mock.run, dispose: async () => {} }),
}));
import { createTaskSandbox } from "@/server/platform/ai/sandbox-tools";
let png: Buffer;
const sessions: ReturnType<typeof createTaskSandbox>[] = [];
beforeEach(async () => {
  vi.clearAllMocks();
  mock.paths.temp = await mkdtemp(join(tmpdir(), "omp-private-practice-"));
  png = await sharp({ create: { width: 20, height: 30, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  mock.run.mockResolvedValue({
    exitCode: 0,
    stdout: "private calculation",
    stderr: "",
    images: [{ name: "reference.png", data: png.toString("base64") }],
  });
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  await rm(mock.paths.temp, { recursive: true, force: true });
});
it.each(["python", "shell"] as const)(
  "%s privately renders actual reference evidence without creating a student-owned asset",
  async (name) => {
    const url = "/api/platform/assets/11111111-1111-4111-8111-111111111111";
    const onImages = vi.fn(async () => {});
    const sandbox = createTaskSandbox({
      userId: "student",
      persistImages: false,
      context: { task: "PRACTICE_GRADE" },
      allowedAssets: new Set([url]),
      readAsset: async () => png,
      onImages,
      ensureOpen: () => {},
    });
    sessions.push(sandbox);
    const output = await sandbox.tools[name].execute!(
      { code: "print('image')", command: "true", assets: [url], images: ["reference.png"] },
      { toolCallId: "call", messages: [], context: {} },
    );
    expect(mock.save).not.toHaveBeenCalled();
    expect(onImages).toHaveBeenCalledWith([], [url]);
    expect(output).toMatchObject({
      exitCode: 0,
      images: [{ name: "reference.png", image: expect.any(String) }],
      previews: [{ url, image: expect.any(String) }],
    });
    expect((output as { images: { url?: string }[] }).images[0].url).toBeUndefined();
  },
);
it("does not mark source images inspected if an exported scratch image cannot be decoded", async () => {
  const url = "/api/platform/assets/11111111-1111-4111-8111-111111111111";
  const onImages = vi.fn(async () => {});
  const sandbox = createTaskSandbox({
    userId: "student",
    persistImages: false,
    context: { task: "PRACTICE_GRADE" },
    allowedAssets: new Set([url]),
    readAsset: async () => png,
    onImages,
    ensureOpen: () => {},
  });
  sessions.push(sandbox);
  // Valid PNG structure/checksums (PIL.verify accepts it), but the IDAT pixels cannot decode.
  mock.run.mockResolvedValueOnce({
    exitCode: 0,
    stdout: "",
    stderr: "",
    images: [
      {
        name: "reference.png",
        data: "iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAIAAACjcKk8AAAAD0lEQVRub3QtemxpYi1waXhlbHPT2CRhAAAAAElFTkSuQmCC",
      },
    ],
  });
  await expect(
    sandbox.tools.python.execute!(
      { code: "print('image')", assets: [url], images: ["reference.png"] },
      { toolCallId: "call", messages: [], context: {} },
    ),
  ).rejects.toThrow();
  expect(onImages).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
});
