import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  aiProvider: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
  aiModel: { deleteMany: vi.fn(), upsert: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => db }));
vi.mock("@/server/auth/accounts", () => ({ createManagedAccount: vi.fn() }));
import { adminCommandSchema, executeAdmin } from "@/server/platform/admin";
import { reasoningEfforts } from "@/contracts/ai-models";

beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.aiProvider.findUnique.mockResolvedValue({ id: "provider" });
  db.$transaction.mockImplementation(async (run) => run(db));
});

describe("provider model names", () => {
  const command = {
    type: "provider.save",
    provider: {
      id: "provider",
      name: "学校服务",
      apiType: "openai_chat",
      baseURL: "https://example.test/v1",
      maxOutputTokens: 16384,
      models: [{ name: "vendor/model-id", displayName: "课堂助手" }],
    },
  };
  it("persists the display name on both insert and update without changing the API model ID", async () => {
    db.aiProvider.findUnique.mockResolvedValue({ id: "provider", encryptedApiKey: "saved-key" });
    db.aiProvider.update.mockResolvedValue({ id: "provider" });
    await executeAdmin("admin", adminCommandSchema.parse(command));
    expect(db.aiModel.upsert).toHaveBeenCalledWith({
      where: { providerId_name: { providerId: "provider", name: "vendor/model-id" } },
      create: {
        providerId: "provider",
        name: "vendor/model-id",
        displayName: "课堂助手",
        reasoningEffort: "provider-default",
        reasoningEfforts: ["default"],
        isPublic: true,
      },
      update: { displayName: "课堂助手", reasoningEffort: "provider-default", isPublic: true },
    });
  });
  it.each(["http", "websocket"])(
    "persists transport mode %s and uses HTTP for other protocols",
    async (transportMode) => {
      db.aiProvider.findUnique.mockResolvedValue({ id: "provider", encryptedApiKey: "saved-key" });
      db.aiProvider.update.mockResolvedValue({ id: "provider" });
      for (const apiType of ["openai_responses", "openai_chat", "anthropic", "google"]) {
        await executeAdmin(
          "admin",
          adminCommandSchema.parse({
            ...command,
            provider: { ...command.provider, apiType, transportMode },
          }),
        );
        expect(db.aiProvider.update).toHaveBeenLastCalledWith({
          where: { id: "provider" },
          data: expect.objectContaining({
            transportMode: apiType === "openai_responses" ? transportMode : "http",
          }),
        });
      }
      const parsed = adminCommandSchema.parse(command);
      if (parsed.type === "provider.save") expect(parsed.provider.transportMode).toBe("http");
      expect(
        adminCommandSchema.safeParse({
          ...command,
          provider: { ...command.provider, transportMode: "invalid" },
        }).success,
      ).toBe(false);
    },
  );
  it("allows clearing the display name, trims fields and rejects duplicate or empty IDs", () => {
    const parseModels = (models: unknown) =>
      adminCommandSchema.safeParse({ ...command, provider: { ...command.provider, models } });
    const valid = parseModels([{ name: " model-id ", displayName: " " }]);
    expect(valid.success).toBe(true);
    if (valid.success && valid.data.type === "provider.save")
      expect(valid.data.provider.models).toEqual([
        { name: "model-id", displayName: "", reasoningEffort: "provider-default" },
      ]);
    expect(parseModels([{ name: "", displayName: "助手" }]).success).toBe(false);
    expect(
      parseModels([
        { name: "same", displayName: "一" },
        { name: " same ", displayName: "二" },
      ]).success,
    ).toBe(false);
    expect(parseModels([]).success).toBe(false);
  });
  it.each(reasoningEfforts)(
    "persists per-model reasoning effort %s on creation and update",
    async (reasoningEffort) => {
      db.aiProvider.findUnique.mockResolvedValue({ id: "provider", encryptedApiKey: "saved-key" });
      db.aiProvider.update.mockResolvedValue({ id: "provider" });
      await executeAdmin(
        "admin",
        adminCommandSchema.parse({
          ...command,
          provider: {
            ...command.provider,
            models: [
              { name: "first", displayName: "", reasoningEffort },
              { name: "second", displayName: "", reasoningEffort: "low" },
            ],
          },
        }),
      );
      expect(db.aiModel.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          create: expect.objectContaining({ reasoningEffort }),
          update: expect.objectContaining({ reasoningEffort }),
        }),
      );
      expect(db.aiModel.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          create: expect.objectContaining({ reasoningEffort: "low" }),
          update: expect.objectContaining({ reasoningEffort: "low" }),
        }),
      );
    },
  );
  it("rejects unsupported reasoning effort values", () => {
    expect(
      adminCommandSchema.safeParse({
        ...command,
        provider: {
          ...command.provider,
          models: [{ name: "model", displayName: "", reasoningEffort: "invalid" }],
        },
      }).success,
    ).toBe(false);
  });
});

describe("administrator provider deletion", () => {
  it("requires administrator permission before touching the provider", async () => {
    db.user.findUnique.mockResolvedValue({ role: "TEACHER" });
    await expect(
      executeAdmin("teacher", { type: "provider.delete", id: "provider" }),
    ).rejects.toThrow("需要管理员权限");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.aiProvider.delete).not.toHaveBeenCalled();
  });
  it("rechecks permission in the transaction after acquiring the role-change lock", async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN" })
      .mockResolvedValueOnce({ role: "TEACHER" });
    await expect(
      executeAdmin("demoted", { type: "provider.delete", id: "provider" }),
    ).rejects.toThrow("需要管理员权限");
    expect(db.$executeRaw).toHaveBeenCalledOnce();
    expect(db.aiProvider.delete).not.toHaveBeenCalled();
  });
  it("rejects missing IDs and providers, and deletes only the selected provider", async () => {
    expect(adminCommandSchema.safeParse({ type: "provider.delete", id: "" }).success).toBe(false);
    db.aiProvider.findUnique.mockResolvedValueOnce(null);
    await expect(executeAdmin("admin", { type: "provider.delete", id: "missing" })).rejects.toThrow(
      "模型供应商不存在",
    );
    expect(db.aiProvider.delete).not.toHaveBeenCalled();
    await expect(
      executeAdmin("admin", adminCommandSchema.parse({ type: "provider.delete", id: "provider" })),
    ).resolves.toEqual({ id: "provider" });
    expect(db.aiProvider.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: "provider" } });
  });
});
