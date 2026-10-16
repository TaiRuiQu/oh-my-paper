import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ create: vi.fn(), asset: vi.fn(), directory: "" }));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => ({ storage: mocks.directory }) }));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({ platformAsset: { create: mocks.create } }),
}));
vi.mock("@/server/platform/assets", () => ({
  accessibleAsset: mocks.asset,
  assetId: (url: string) => url.split("/").at(-1),
}));
import { saveXiaozhiAttachment } from "@/server/xiaozhi/attachments";
import { createXiaozhiSandbox } from "@/server/xiaozhi/sandbox";

describe("小纸原始附件", () => {
  afterEach(async () => {
    if (mocks.directory) await rm(mocks.directory, { recursive: true, force: true });
    vi.clearAllMocks();
  });
  it.each([
    ["原卷.pdf", "application/pdf"],
    ["照片.jpg", "image/jpeg"],
    ["材料.docx", "application/octet-stream"],
  ])("stores %s byte for byte without decoding or preprocessing", async (name, mediaType) => {
    mocks.directory = await mkdtemp(join(tmpdir(), "xiaozhi-original-"));
    const bytes = Buffer.from([0, 255, 37, 80, 68, 70, 10, 99]);
    const result = await saveXiaozhiAttachment("owner", bytes, name);
    expect(result).toMatchObject({ name, mediaType, size: bytes.length });
    const saved = mocks.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({ ownerId: "owner", name, contentType: mediaType });
    expect(await readFile(saved.path)).toEqual(bytes);
    expect(result).not.toHaveProperty("pages");
  });
  it("mounts authorized original bytes under /inputs and keeps attachment paths confined", async () => {
    mocks.directory = await mkdtemp(join(tmpdir(), "xiaozhi-input-"));
    const bytes = Buffer.from("%PDF-1.7\noriginal compressed bytes\n");
    mocks.asset.mockResolvedValue({ buffer: bytes, contentType: "application/pdf" });
    const sandbox = createXiaozhiSandbox("owner", mocks.directory);
    try {
      const attachments = await sandbox.stage({
        id: "message",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "../../原卷.pdf",
            url: "/api/platform/assets/11111111-1111-1111-1111-111111111111",
            mediaType: "application/pdf",
          },
        ],
      });
      expect(mocks.asset).toHaveBeenCalledWith("owner", "11111111-1111-1111-1111-111111111111");
      expect(attachments[0].path).toMatch(
        /^\/inputs\/11111111-1111-1111-1111-111111111111\/[^/]+$/,
      );
      expect(await readFile(join(mocks.directory, attachments[0].path.slice(1)))).toEqual(bytes);
    } finally {
      await sandbox.dispose();
    }
  });
  it("rejects empty or oversized files before creating an asset", async () => {
    await expect(saveXiaozhiAttachment("owner", Buffer.alloc(0), "empty.pdf")).rejects.toThrow(
      "文件为空",
    );
    await expect(
      saveXiaozhiAttachment("owner", Buffer.alloc(30_000_001), "big.pdf"),
    ).rejects.toThrow("30 MB");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
