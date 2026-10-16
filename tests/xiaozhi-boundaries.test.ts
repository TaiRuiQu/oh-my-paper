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
  it("exposes exact school routes and current schemas without granting generic school paths", () => {
    for (const [path, method] of [
      ["/api/platform/school/state", "GET"],
      ["/api/platform/school/commands", "POST"],
      ["/api/platform/school/timetable/check", "GET"],
      ["/api/platform/school/schedule", "GET"],
    ])
      expect(resolveWebsitePath(path, method)).toBeDefined();
    for (const path of [
      "/api/platform/school/other",
      "/api/platform/school/evil/state",
      "/api/platform/school/evil/commands",
    ])
      expect(() => resolveWebsitePath(path, "GET")).toThrow();
    expect(() => resolveWebsitePath("/api/platform/school/state", "POST")).toThrow();
    const schema = describeApi("school.timetable.save") as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("expectedRevision");
    expect(schema.properties).toHaveProperty("timetable");
    expect((describeApi("operations") as { schoolCommands: string[] }).schoolCommands).toHaveLength(
      7,
    );
  });
  it("exposes exact classroom endpoints and versioned commands without student write shortcuts", () => {
    for (const path of [
      "/api/platform/teaching/sessions",
      "/api/platform/teaching/sessions/lesson-id",
      "/api/platform/teaching/sessions/lesson-id/roster-preview",
      "/api/platform/teaching/sessions/lesson-id/history",
    ])
      expect(resolveWebsitePath(path, "GET")).toBeDefined();
    expect(resolveWebsitePath("/api/platform/teaching/commands", "POST")).toBeDefined();
    for (const path of [
      "/api/platform/teaching/state",
      "/api/platform/teaching/anything/commands",
      "/api/platform/teaching/sessions/lesson-id/roster",
    ])
      expect(() => resolveWebsitePath(path, "GET")).toThrow();
    expect(() => resolveWebsitePath("/api/platform/teaching/sessions/lesson-id", "POST")).toThrow();
    const schema = describeApi("teaching.plan.save") as { properties: Record<string, unknown> };
    for (const name of [
      "sessionId",
      "expectedVersion",
      "expectedPlanVersion",
      "expectedBindingVersion",
      "plan",
    ])
      expect(schema.properties).toHaveProperty(name);
    expect(
      (describeApi("operations") as { teachingCommands: string[] }).teachingCommands,
    ).toHaveLength(13);
    expect(
      (describeApi("LESSON_PREPARE") as { properties: Record<string, unknown> }).properties,
    ).toHaveProperty("input");
  });
  it("describes versioned homework collection and restricts exact student upload paths", () => {
    for (const path of [
      "/api/platform/homework/assignments",
      "/api/platform/homework/assignments/assignment-id",
      "/api/platform/homework/assignments/assessment-id/preview",
      "/api/platform/homework/assignments/assignment-id/history",
    ])
      expect(resolveWebsitePath(path, "GET")).toBeDefined();
    expect(resolveWebsitePath("/api/platform/homework/commands", "POST")).toBeDefined();
    expect(resolveWebsitePath("/api/platform/homework/works/work-id/assets", "POST")).toBeDefined();
    expect(() =>
      resolveWebsitePath("/api/platform/homework/works/work-id/assets", "GET"),
    ).toThrow();
    expect(() =>
      resolveWebsitePath("/api/platform/homework/works/work-id/commands", "POST"),
    ).toThrow();
    const schema = describeApi("homework.submit") as { properties: Record<string, unknown> };
    for (const key of [
      "workId",
      "expectedVersion",
      "expectedDraftVersion",
      "expectedAssignmentVersion",
      "expectedRosterRevision",
      "requestId",
    ])
      expect(schema.properties).toHaveProperty(key);
    expect(schema.properties).not.toHaveProperty("studentId");
    expect(
      (describeApi("operations") as { homeworkCommands: string[] }).homeworkCommands,
    ).toHaveLength(10);
  });
  it("keeps practice commands and submitted-review routes in their own exact allowlist", () => {
    for (const suffix of [
      "sources",
      "sets",
      "sets/set-id",
      "sets/paper-id/preview",
      "sessions",
      "sessions/session-id",
      "sessions/session-id/history",
      "reviews",
      "reviews/attempt-id",
      "evidence",
    ])
      expect(resolveWebsitePath(`/api/platform/practice/${suffix}`, "GET")).toBeDefined();
    expect(resolveWebsitePath("/api/platform/practice/commands", "POST")).toBeDefined();
    expect(
      resolveWebsitePath("/api/platform/practice/sessions/session-id/assets", "POST"),
    ).toBeDefined();
    for (const [path, method] of [
      ["/api/platform/practice/state", "GET"],
      ["/api/platform/practice/sessions/session-id/commands", "POST"],
      ["/api/platform/practice/sessions/session-id/assets", "GET"],
      ["/api/platform/practice/reviews/attempt-id", "POST"],
      ["/api/platform/practice/commands", "PUT"],
    ])
      expect(() => resolveWebsitePath(path, method)).toThrow();
    const schema = describeApi("practice.submit") as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["type", "sessionId", "expectedVersion", "expectedDraftVersion", "requestId"].sort(),
    );
    expect((describeApi("operations") as { practiceCommands: string[] }).practiceCommands).toEqual(
      expect.arrayContaining([
        "practice.reference.reveal",
        "practice.self-assess",
        "practice.review.confirm",
      ]),
    );
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
