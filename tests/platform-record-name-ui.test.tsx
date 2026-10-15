// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecordNameEditor } from "@/components/platform/record-name-editor";

const domain = vi.hoisted(() => ({
  state: { actor: { id: "owner", role: "TEACHER" } },
  pending: false,
  mutate: vi.fn(),
}));
vi.mock("@/components/platform/domain-provider", () => ({ useDomain: () => domain }));

let container: HTMLDivElement, root: Root;
const record = { id: "paper", ownerId: "owner", name: "原作业" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  domain.state.actor = { id: "owner", role: "TEACHER" };
  domain.pending = false;
  domain.mutate.mockReset().mockResolvedValue({ id: record.id });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(kind: "paper" | "assessment" = "paper") {
  await act(async () =>
    root.render(
      <RecordNameEditor
        record={record}
        kind={kind}
        noun={kind === "paper" ? "作业" : "考试"}
        heading
      />,
    ),
  );
}
async function open() {
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
}
async function change(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it.each(["paper", "assessment"] as const)(
  "renames %s with a focused inline field and a name-only command",
  async (kind) => {
    await render(kind);
    expect(container.querySelector("h1")?.textContent).toBe("原作业");
    await open();
    expect(document.activeElement).toBe(container.querySelector("input"));
    expect(container.querySelector("input")?.selectionEnd).toBe(record.name.length);
    await change("  更新后的名称  ");
    await submit();
    expect(domain.mutate).toHaveBeenCalledExactlyOnceWith({
      type: `${kind}.rename`,
      id: "paper",
      name: "更新后的名称",
    });
    expect(container.querySelector("form")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("button"));
  },
);

it("keeps invalid and failed names editable, and lets Escape discard a draft", async () => {
  await render();
  await open();
  await change("   ");
  await submit();
  expect(domain.mutate).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("请输入名称");
  await change("新作业");
  domain.mutate.mockResolvedValueOnce({ error: "暂时无法保存，请重试。" });
  await submit();
  expect(container.querySelector("input")?.value).toBe("新作业");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("暂时无法保存");
  await act(async () =>
    container
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector("form")).toBeNull();
  await open();
  expect(container.querySelector("input")?.value).toBe(record.name);
});

it("disables repeat submission and cancellation while saving", async () => {
  let complete: (result: { id: string }) => void = () => {};
  domain.mutate.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await render();
  await open();
  await change("保存中的作业");
  await submit();
  expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
  expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  expect(container.textContent).toContain("正在保存");
  await submit();
  expect(domain.mutate).toHaveBeenCalledOnce();
  await act(async () => complete({ id: record.id }));
  expect(container.querySelector("form")).toBeNull();
});

it("only offers renaming to the owner or an administrator", async () => {
  domain.state.actor = { id: "other", role: "TEACHER" };
  await render();
  expect(container.querySelector("button")).toBeNull();
  domain.state.actor = { id: "owner", role: "STUDENT" };
  await render();
  expect(container.querySelector("button")).toBeNull();
  domain.state.actor = { id: "admin", role: "ADMIN" };
  await render();
  expect(container.querySelector("button")?.textContent).toContain("重命名");
});
