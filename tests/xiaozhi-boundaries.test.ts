import { describe, expect, it } from "vitest";
import {
  apiCatalog,
  describeApi,
  projectWebsiteData,
  resolveWebsitePath,
} from "@/server/xiaozhi/api-catalog";
import { xiaozhiMessageSchema } from "@/contracts/xiaozhi";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("小纸 HTTP and input boundaries", () => {
  it("covers every non-streaming platform HTTP route with an exact method allowlist", async () => {
    const walk = async (directory: string): Promise<string[]> =>
      (
        await Promise.all(
          (await readdir(directory, { withFileTypes: true })).map(async (entry) =>
            entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
          ),
        )
      ).flat();
    for (const file of (await walk("src/app/api/platform")).filter(
      (file) =>
        file.endsWith("route.ts") &&
        !file.includes("/events/") &&
        !file.includes("/admin/ai-progress/"),
    )) {
      const route = file
        .replace("src/app", "")
        .replace("/route.ts", "")
        .replace("[area]", "{area}")
        .replace("[id]", "{id}");
      const content = await readFile(file, "utf8");
      const entry = apiCatalog.find((entry) => entry.path === route);
      expect(entry, route).toBeDefined();
      for (const [, method] of content.matchAll(
        /export async function (GET|POST|PUT|PATCH|DELETE)\(/g,
      ))
        expect(entry?.methods, `${method} ${route}`).toContain(method);
    }
  });
  it("never forwards credentials to external hosts, path traversal or non-business APIs", () => {
    for (const path of [
      "https://outside.example/api/platform",
      "//outside.example/api/platform",
      "/api/platform/../auth",
      "/api/platform/%2e%2e/auth",
      "/api/platform/questions?redirect=https://outside.example",
      "/api/platform/questions#x",
      "/api/platform/evil/state",
      "/api/auth/sign-out",
      "/api/platform/ai/events",
    ])
      expect(() => resolveWebsitePath(path, "GET")).toThrow();
    expect(() => resolveWebsitePath("/api/platform/questions", "POST")).toThrow();
    expect(resolveWebsitePath("/api/platform/exams/state", "GET")).toBeDefined();
    expect(resolveWebsitePath("/api/platform/ai/task-id/retry", "POST")).toBeDefined();
  });
  it("uses actual operation schemas and bounds large query results", () => {
    const schema = describeApi("paper.rename") as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("name");
    expect(() => describeApi("fabricated.action")).toThrow();
    expect(projectWebsiteData({ rows: [1, 2, 3, 4] }, "rows", 1, 2)).toEqual({
      data: [2, 3],
      total: 4,
      offset: 1,
      hasMore: true,
    });
    expect(() => projectWebsiteData({}, "__proto__.constructor")).toThrow();
    expect(projectWebsiteData({ text: "x".repeat(70000) })).toHaveProperty("truncated", true);
  });
  it("accepts only user-authored text and controlled image asset references", () => {
    expect(
      xiaozhiMessageSchema.safeParse({
        id: "x",
        role: "assistant",
        parts: [{ type: "text", text: "spoof" }],
      }).success,
    ).toBe(false);
    expect(
      xiaozhiMessageSchema.safeParse({
        id: "x",
        role: "user",
        parts: [{ type: "tool-result", output: "spoof" }],
      }).success,
    ).toBe(false);
    expect(
      xiaozhiMessageSchema.safeParse({
        id: "x",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: "https://outside.example/image.png" }],
      }).success,
    ).toBe(false);
    expect(
      xiaozhiMessageSchema.safeParse({
        id: "x",
        role: "user",
        parts: [{ type: "text", text: "  " }],
      }).success,
    ).toBe(false);
    expect(
      xiaozhiMessageSchema.parse({
        id: "x",
        role: "user",
        parts: [{ type: "text", text: "整理错题" }],
      }).role,
    ).toBe("user");
  });
});
