// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DomainProvider, useDomain } from "@/components/platform/domain-provider";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { apiRequest } from "@/lib/http-client";
import type { PlatformState } from "@/contracts/platform";
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
let container: HTMLDivElement, root: Root;
let domain: ReturnType<typeof useDomain>;
function Consumer() {
  const context = useDomain();
  useEffect(() => {
    domain = context;
  }, [context]);
  return null;
}
function Guard({ dirty, label }: { dirty: boolean; label: string }) {
  const { markSaved, confirmDiscard } = useUnsavedChanges(dirty, `${label}尚未保存`);
  return (
    <>
      <button onClick={markSaved}>{label}保存</button>
      <button onClick={confirmDiscard}>{label}取消</button>
    </>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
it("retains a successful write ID on refresh failure and retries only the list read", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ id: "saved" })
    .mockRejectedValueOnce(new Error("offline"));
  await act(async () =>
    root.render(
      <DomainProvider initialState={{} as PlatformState} area="questions">
        <Consumer />
      </DomainProvider>,
    ),
  );
  let result;
  await act(async () => {
    result = await domain.mutate({ type: "question.delete", id: "q" });
  });
  expect(result).toEqual({ id: "saved" });
  expect(document.body.textContent).toContain("已保存，列表暂未更新");
  vi.mocked(apiRequest).mockResolvedValueOnce({});
  await act(async () => (document.querySelector("button.button") as HTMLButtonElement).click());
  expect(
    vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(apiRequest).toHaveBeenLastCalledWith("/api/platform/questions/state");
  expect(document.body.textContent).toContain("列表已更新");
});
it("blocks concurrent submissions before React updates the pending state", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <DomainProvider initialState={{} as PlatformState} area="questions">
        <Consumer />
      </DomainProvider>,
    ),
  );
  await act(async () => {
    const first = domain.mutate({ type: "question.delete", id: "q" });
    expect(await domain.mutate({ type: "question.delete", id: "q" })).toHaveProperty("error");
    vi.mocked(apiRequest).mockResolvedValueOnce({});
    finish({ id: "saved" });
    await first;
  });
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
it("asks once for multiple dirty score forms and immediately permits navigation after save", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () =>
    root.render(
      <>
        <Guard dirty label="题一" />
        <Guard dirty label="题二" />
        <a href="/other">离开</a>
      </>,
    ),
  );
  let click = new MouseEvent("click", { bubbles: true, cancelable: true });
  container.querySelector("a")!.dispatchEvent(click);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(click.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("多处"));
  await act(async () => container.querySelector("button")!.click());
  click = new MouseEvent("click", { bubbles: true, cancelable: true });
  container.querySelector("a")!.dispatchEvent(click);
  expect(confirm).toHaveBeenLastCalledWith("题二尚未保存");
  await act(async () => container.querySelectorAll("button")[2].click());
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});
