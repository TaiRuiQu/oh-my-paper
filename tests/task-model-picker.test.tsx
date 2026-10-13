// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskModelPicker, useTaskModelSettings } from "@/components/task-model-picker";
import type { TaskModelSelection, UserAiSettings } from "@/contracts/user-ai";
const settings: UserAiSettings = {
  credits: "100",
  models: [
    { id: "one", name: "快速模型", creditMultiplier: 1 },
    { id: "two", name: "精确模型", creditMultiplier: 3 },
  ],
  selections: { exam: null, answer: "two", grading: null },
  defaults: { exam: "one", answer: "one", grading: "one" },
};
vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("model choices at task creation", () => {
  it("shows effective defaults, keeps per-purpose overrides local and allows returning to defaults", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div"),
      root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const changes = vi.fn();
    function Form() {
      const query = useTaskModelSettings(settings),
        [value, setValue] = useState<TaskModelSelection>({});
      return (
        <TaskModelPicker
          query={query}
          purposes={["exam", "answer", "grading"]}
          value={value}
          onChange={(next) => {
            changes(next);
            setValue(next);
          }}
        />
      );
    }
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Form />
        </QueryClientProvider>,
      ),
    );
    cleanup = () => {
      act(() => root.unmount());
      client.clear();
    };
    const selects = container.querySelectorAll("select");
    expect(selects[0].selectedOptions[0].textContent).toContain("后台默认 · 快速模型");
    expect(selects[1].selectedOptions[0].textContent).toContain("账户默认 · 精确模型");
    act(() => {
      selects[0].value = "two";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(changes).toHaveBeenLastCalledWith({ exam: "two" });
    expect(selects[1].value).toBe("");
    expect(settings.selections.exam).toBeNull();
    act(() => {
      selects[0].value = "";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(changes).toHaveBeenLastCalledWith({});
    expect(container.textContent).not.toContain("输入 token");
  });
});
