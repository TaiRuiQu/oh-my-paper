// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DomainProvider, useDomain } from "@/components/platform/domain-provider";
import type { PlatformState } from "@/contracts/platform";

let container: HTMLDivElement, root: Root;
function NotifyButtons() {
  const { notify } = useDomain();
  return (
    <>
      <button onClick={() => notify("已保存。")}>保存成功</button>
      <button onClick={() => notify("保存失败，请重试。", true)}>保存失败</button>
    </>
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <DomainProvider initialState={{} as PlatformState} area="homework">
        <NotifyButtons />
      </DomainProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
it("shows success outside the page layout and dismisses it automatically", async () => {
  await act(async () => container.querySelectorAll("button")[0].click());
  expect(document.body.querySelector('[role="status"]')?.textContent).toBe("已保存。");
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(4000));
  expect(document.body.querySelector('[role="status"]')).toBeNull();
});
it("keeps errors visible until the teacher closes them", async () => {
  await act(async () => container.querySelectorAll("button")[1].click());
  await act(async () => vi.advanceTimersByTime(10000));
  expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("保存失败，请重试。");
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="关闭操作提示"]')!.click(),
  );
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
});
