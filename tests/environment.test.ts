import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("server configuration", () => {
  it("reports invalid variable names without exposing secrets", async () => {
    vi.stubEnv("DATABASE_URL", "secret-database-value");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret");
    const { getEnv } = await import("@/server/config/env");
    expect(getEnv).toThrow(/DATABASE_URL/);
    try {
      getEnv();
    } catch (error) {
      expect(String(error)).not.toContain("secret-database-value");
    }
  });

  it("rejects placeholder authentication secrets", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "REPLACE_WITH_RANDOM_SECRET_1234567890");
    const { getEnv } = await import("@/server/config/env");
    expect(getEnv).toThrow(/BETTER_AUTH_SECRET/);
  });
});
