import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ user: { count: mocks.count } }) }));
import { roleForNewAccount } from "@/server/auth/index";
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetAllMocks();
});
describe("first account bootstrap", () => {
  it("promotes the first account so a fresh install can configure providers", async () => {
    mocks.count.mockResolvedValue(0);
    expect(await roleForNewAccount()).toBe("ADMIN");
  });
  it("leaves every later account as an ordinary user", async () => {
    mocks.count.mockResolvedValue(1);
    expect(await roleForNewAccount()).toBe("USER");
    mocks.count.mockResolvedValue(42);
    expect(await roleForNewAccount()).toBe("USER");
  });
  it("reads the current account count on every registration", async () => {
    mocks.count.mockResolvedValue(0);
    await roleForNewAccount();
    mocks.count.mockResolvedValue(1);
    await roleForNewAccount();
    expect(mocks.count).toHaveBeenCalledTimes(2);
  });
});
