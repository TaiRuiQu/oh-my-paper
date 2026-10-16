// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Classroom } from "@/contracts/platform";
import { ClassListPage } from "@/components/platform/class-pages";

const mocks = vi.hoisted(() => ({ classrooms: [] as Classroom[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({
    state: { actor: { id: "teacher", role: "TEACHER" }, classrooms: mocks.classrooms },
  }),
}));
vi.mock("@/components/platform/account-import", () => ({ AccountImport: () => null }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.classrooms = [
    { id: "class", ownerId: "teacher", name: "1班", stage: "初中", cohort: "2027届", students: [] },
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索班级"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

it("explains an unmatched search and restores existing classes when cleared", async () => {
  await act(async () => root.render(createElement(ClassListPage)));
  const input = await search("不存在");
  expect(container.textContent).toContain("没有找到与“不存在”匹配的班级");
  expect(container.textContent).not.toContain("创建班级后添加学生");
  expect(container.querySelector('a[href="/workspace/classes/class"]')).toBeNull();
  const clear = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "清空搜索",
  )!;
  await act(async () => clear.click());
  expect(input.value).toBe("");
  expect(container.querySelector('a[href="/workspace/classes/class"]')).not.toBeNull();
});

it("trims search text and treats whitespace as an empty query", async () => {
  await act(async () => root.render(createElement(ClassListPage)));
  await search("  初中  ");
  expect(container.querySelector('a[href="/workspace/classes/class"]')).not.toBeNull();
  await search("   ");
  expect(container.querySelector('a[href="/workspace/classes/class"]')).not.toBeNull();
  expect(container.textContent).not.toContain("没有找到");
});

it("shows first-use guidance when no classes exist", async () => {
  mocks.classrooms = [];
  await act(async () => root.render(createElement(ClassListPage)));
  expect(container.textContent).toContain("创建班级后添加学生");
  expect(container.textContent).not.toContain("没有找到");
});
