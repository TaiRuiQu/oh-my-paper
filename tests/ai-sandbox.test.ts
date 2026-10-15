import { expect, it } from "vitest";
import { sandboxInputSchema, sandboxRemediation } from "@/server/ai/sandbox";

it("accepts one executable input and only bounded relative image names", () => {
  expect(sandboxInputSchema.parse({ code: "print(1)" }).images).toEqual([]);
  expect(
    sandboxInputSchema.safeParse({ command: "pwd", images: ["crops/part-1.png"] }).success,
  ).toBe(true);
  for (const images of [
    ["../secret.png"],
    ["/inputs/image.png"],
    ["a/../../b.png"],
    ["x.gif"],
    Array(4).fill("x.png"),
  ])
    expect(sandboxInputSchema.safeParse({ code: "pass", images }).success).toBe(false);
  expect(sandboxInputSchema.safeParse({ code: "pass", command: "pwd" }).success).toBe(false);
  expect(sandboxInputSchema.safeParse({ code: "x".repeat(60001) }).success).toBe(false);
});

it("gives operators actionable namespace, proc mount and missing runtime diagnostics", () => {
  expect(sandboxRemediation("creating new user namespace: Operation not permitted")).toContain(
    "用户命名空间",
  );
  expect(sandboxRemediation("Can't mount proc on /newroot/proc")).toContain(
    "systempaths=unconfined",
  );
  expect(sandboxRemediation("spawn bwrap ENOENT")).toContain("BWRAP_PATH");
  expect(sandboxRemediation("custom model error")).toBe("");
});
