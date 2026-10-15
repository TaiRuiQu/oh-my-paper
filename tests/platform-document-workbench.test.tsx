// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentWorkbench } from "@/components/platform/document-workbench";

let container: HTMLDivElement, root: Root;
let originalOverflow: string;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
  originalOverflow = document.body.style.overflow;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.overflow = originalOverflow;
});

async function render(notice?: ReactNode) {
  const submit = vi.fn();
  await act(async () =>
    root.render(
      <>
        <button data-background>返回工作台</button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DocumentWorkbench
            title="数学练习"
            status="有未保存的修改"
            actions={<button type="submit">保存试卷</button>}
            ribbon={
              <label>
                字体
                <select defaultValue="宋体">
                  <option>宋体</option>
                </select>
              </label>
            }
            notice={notice}
          >
            <div>
              <input aria-label="题干" defaultValue="原题干" />
            </div>
          </DocumentWorkbench>
        </form>
      </>,
    ),
  );
  return submit;
}

function button(name: string) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent === name)!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
function workbench() {
  return container.querySelector<HTMLElement>("[data-fullscreen]")!;
}
async function escape(target: EventTarget = document) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

it("retains the draft and save controls across full-screen changes without submitting the form", async () => {
  const submit = await render(<p role="alert">此版本已布置，修改后另存新版本。</p>);
  const draft = container.querySelector("input")!;
  draft.value = "尚未保存的新题干";
  await click("全屏");
  expect(workbench().dataset.fullscreen).toBe("true");
  expect(workbench().querySelector('[role="alert"]')?.textContent).toContain("另存新版本");
  expect(button("退出全屏").getAttribute("aria-pressed")).toBe("true");
  await click("退出全屏");
  expect(container.querySelector("input")).toBe(draft);
  expect(draft.value).toBe("尚未保存的新题干");
  expect(submit).not.toHaveBeenCalled();
  await click("保存试卷");
  expect(submit).toHaveBeenCalledOnce();
});

it("locks background scrolling and keyboard navigation, then restores both on Escape", async () => {
  await render();
  document.body.style.overflow = "auto";
  const background = container.querySelector<HTMLElement>("[data-background]")!;
  await click("全屏");
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  await escape();
  expect(workbench().dataset.fullscreen).toBe("false");
  expect(background.inert).not.toBe(true);
  expect(document.body.style.overflow).toBe("auto");
  expect(document.activeElement).toBe(button("全屏"));
});

it("lets an open question dialog handle Escape before leaving full-screen mode", async () => {
  await render();
  await click("全屏");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.dataset.state = "open";
  document.body.append(dialog);
  await escape(dialog);
  expect(workbench().dataset.fullscreen).toBe("true");
  dialog.remove();
  await escape();
  expect(workbench().dataset.fullscreen).toBe("false");
});

it("ends route-entry motion before positioning the full-screen editor", async () => {
  await render();
  const cancel = vi.fn();
  Object.assign(container, { getAnimations: () => [{ cancel }] });
  await click("全屏");
  expect(cancel).toHaveBeenCalledOnce();
});

it("keeps side panels independent and restores background state when navigating away", async () => {
  await render();
  const background = container.querySelector<HTMLElement>("[data-background]")!;
  background.inert = true;
  await click("全屏");
  await click("目录");
  expect(workbench().dataset.outline).toBe("false");
  expect(workbench().dataset.properties).toBe("true");
  await click("属性");
  expect(workbench().dataset.properties).toBe("false");
  await act(async () => root.render(null));
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe(originalOverflow);
});
