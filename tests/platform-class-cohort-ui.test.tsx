// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClassEditPage } from "@/components/platform/class-pages";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: { classrooms: [] }, mutate: mocks.mutate, pending: false }),
}));
vi.mock("@/components/platform/account-import", () => ({ AccountImport: () => null }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.mutate.mockReset().mockResolvedValue({ id: "class" });
  mocks.push.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it.each([
  ["高中", "2027届"],
  ["初中", "2027届"],
  ["小学", "2027届"],
  ["高中", "2024级"],
])(
  "creates a class with stage %s cohort %s independently of curriculum grades",
  async (stage, cohort) => {
    await act(async () => root.render(createElement(ClassEditPage)));
    const name = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    const cohortInput = container.querySelector<HTMLInputElement>('input[name="cohort"]')!;
    const stageInput = container.querySelector<HTMLSelectElement>('select[name="stage"]')!;
    expect(stageInput.required).toBe(true);
    expect([...stageInput.options].map((o) => o.value)).toEqual(["", "小学", "初中", "高中"]);
    stageInput.value = stage;
    expect(cohortInput.value).toBe("");
    expect(cohortInput.required).toBe(true);
    expect(container.textContent).toContain("学生届别");
    expect(container.textContent).toContain("按所选学段的毕业年份");
    expect(container.querySelector('[name="grade"]')).toBeNull();
    name.value = "1班";
    cohortInput.value = cohort;
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.mutate).toHaveBeenCalledWith({
      type: "classroom.save",
      classroom: { id: undefined, name: "1班", stage, cohort },
    });
    expect(mocks.push).toHaveBeenCalledWith("/workspace/classes/class");
  },
);
