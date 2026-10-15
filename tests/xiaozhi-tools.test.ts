import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ BETTER_AUTH_URL: "https://paper.example" }),
}));
vi.mock("@/server/platform/access", () => ({
  getActor: async () => ({ id: "teacher", role: "TEACHER", name: "Teacher" }),
}));
import { createXiaozhiTools } from "@/server/xiaozhi/tools";

describe("小纸 website tool execution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const invoke = (input: unknown) => {
    const tool: ToolRegistration = createXiaozhiTools("teacher", "session=private").find(
      (tool) => tool.name === "website_request",
    )!;
    return tool.execute(input, {} as ToolExecutionApi, BACKGROUND_CONTEXT);
  };
  it("preserves a successful mutation result even when the model requests a nonexistent projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "created-once" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invoke({
      path: "/api/platform",
      method: "POST",
      body: { type: "classroom.save" },
      select: "classroom",
    });
    expect(result.isError).toBe(false);
    const text = result.output?.[0];
    expect(text?.type === "text" && JSON.parse(text.text)).toMatchObject({
      status: 200,
      mutationApplied: true,
      data: { id: "created-once" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses configured internal origin with the website's real CSRF origin and never follows redirects", async () => {
    vi.stubEnv("XIAOZHI_WEBSITE_URL", "http://web:3000");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ rows: [1] }));
    vi.stubGlobal("fetch", fetchMock);
    await invoke({ path: "/api/platform/questions", method: "GET", query: { q: "一次函数" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.origin).toBe("http://web:3000");
    expect(init.headers.get("Origin")).toBe("https://paper.example");
    expect(init.headers.get("Cookie")).toBe("session=private");
    expect(init.redirect).toBe("error");
    await invoke({ path: "https://outside.example/api/platform", method: "GET" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not write AI scores as human reviews", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await invoke({
      path: "/api/platform",
      method: "POST",
      body: { type: "review.save", review: {} },
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports an uncertain network mutation without retrying it", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("socket closed"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invoke({
      path: "/api/platform",
      method: "POST",
      body: { type: "paper.rename", id: "paper", name: "新名称" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain("可能已生效");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
