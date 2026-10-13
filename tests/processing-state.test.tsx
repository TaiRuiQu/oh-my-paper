// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessingState } from "@/components/processing-state";
let root: Root;
let container: HTMLDivElement;
const submittedAt = "2026-10-12T12:00:00Z";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T12:02:30Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function mount(startedAt?: string) {
  act(() => root.render(<ProcessingState startedAt={startedAt} />));
  act(() => vi.advanceTimersByTime(0));
}
describe("processing elapsed time", () => {
  it("updates actual credit consumption alongside question progress", () => {
    act(() => root.render(<ProcessingState creditsSpent="0.00000001" />));
    expect(container.textContent).toContain("已消费 0.00000001 credit");
    act(() => root.render(<ProcessingState creditsSpent="1.40000000" />));
    expect(container.textContent).toContain("已消费 1.4 credit");
  });
  it("shows elapsed submission time, ticks every second, and stops after leaving", () => {
    mount(submittedAt);
    expect(container.querySelector("h2")?.textContent).toContain("正在处理，请稍候2m 30s");
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("2m 31s");
    expect(container.querySelector('[role="timer"]')?.getAttribute("aria-live")).toBe("off");
    act(() => root.render(<div>已完成</div>));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("continues from the persisted timestamp after refreshing or remounting", () => {
    mount(submittedAt);
    act(() => vi.advanceTimersByTime(30_000));
    act(() => root.unmount());
    root = createRoot(container);
    mount(submittedAt);
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("3m 0s");
  });
  it("keeps generic loading states timer-free and clamps clock skew", () => {
    mount();
    expect(container.querySelector('[role="timer"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    mount("invalid timestamp");
    expect(container.querySelector('[role="timer"]')).toBeNull();
    mount("2026-10-12T12:03:00Z");
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("0m 0s");
  });
  it("shows saved question counts with an accessible animated progress bar", () => {
    act(() =>
      root.render(
        <ProcessingState progress={[{ label: "已解析题目", total: 20, completed: 3 }]} />,
      ),
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(container.textContent).toContain("3 / 20 题");
    expect(bar?.getAttribute("aria-valuenow")).toBe("3");
    expect(bar?.getAttribute("aria-valuemax")).toBe("20");
    expect(bar?.querySelector<HTMLElement>("span")?.style.transform).toBe("scaleX(0.15)");
    act(() =>
      root.render(
        <ProcessingState progress={[{ label: "已解析题目", total: null, completed: 0 }]} />,
      ),
    );
    expect(container.textContent).toContain("正在确认题目总数");
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(
      false,
    );
  });
});
