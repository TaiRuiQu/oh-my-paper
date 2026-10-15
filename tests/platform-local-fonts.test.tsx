// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentFormatControls } from "@/components/platform/document-controls";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";

vi.mock("@/components/platform/questions", () => ({ QuestionEditor: () => null }));
vi.mock("@/components/platform/question-bank-picker", () => ({ QuestionBankPicker: () => null }));

let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as Window & { queryLocalFonts?: unknown }).queryLocalFonts;
});
async function render() {
  await act(async () =>
    root.render(
      createElement(DocumentFormatControls, {
        layout: { ...DOCUMENT_DEFAULTS },
        onChange: vi.fn(),
      }),
    ),
  );
}
async function requestFonts() {
  await act(async () => container.querySelector("button")!.click());
}
it("reads and deduplicates local fonts only after the teacher explicitly requests them", async () => {
  const query = vi.fn(async () => [
    { family: "Noto Serif CJK SC" },
    { family: "Noto Serif CJK SC" },
    { family: "教师本机字体" },
  ]);
  Object.assign(window, { queryLocalFonts: query });
  await render();
  expect(query).not.toHaveBeenCalled();
  await requestFonts();
  expect(query).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('option[value="Noto Serif CJK SC"]')).toHaveLength(1);
  expect(container.querySelector('option[value="教师本机字体"]')).not.toBeNull();
  expect(container.querySelector("input[list]")).not.toBeNull();
});
it("keeps manual font entry available when local font access is denied", async () => {
  Object.assign(window, {
    queryLocalFonts: vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    }),
  });
  await render();
  await requestFonts();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("可直接输入");
  expect(container.querySelector("input[list]")?.hasAttribute("disabled")).toBe(false);
});
it("explains manual entry when this browser has no local font API", async () => {
  await render();
  await requestFonts();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("不支持读取字体列表");
});
