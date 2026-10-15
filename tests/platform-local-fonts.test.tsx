// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentFormatControls } from "@/components/platform/document-controls";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";
import type { DocumentLayout } from "@/contracts/platform";

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
async function render(layout: DocumentLayout = { ...DOCUMENT_DEFAULTS }) {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(DocumentFormatControls, {
        layout,
        onChange,
      }),
    ),
  );
  return onChange;
}
function fontSelect() {
  const label = [...container.querySelectorAll("label")].find(
    (label) => label.textContent === "字体",
  )!;
  return document.getElementById(label.htmlFor) as HTMLSelectElement;
}
async function selectFont(value: string) {
  await act(async () => {
    fontSelect().value = value;
    fontSelect().dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function requestFonts() {
  const option = [...fontSelect().options].find(
    (option) => option.textContent === "读取本机字体…",
  )!;
  await selectFont(option.value);
}
it("selects fonts by their readable names while preserving the document layout", async () => {
  const layout = { ...DOCUMENT_DEFAULTS, columns: 3 };
  const onChange = await render(layout);
  expect(fontSelect().selectedOptions[0].textContent).toBe("新宋体");
  await selectFont("SimSun");
  expect(onChange).toHaveBeenLastCalledWith({ ...layout, fontFamily: "SimSun" });
});
it("reads and deduplicates local fonts only after the teacher explicitly requests them", async () => {
  const query = vi.fn(async () => [
    { family: "Noto Serif CJK SC" },
    { family: "Noto Serif CJK SC" },
    { family: "教师本机字体" },
    { family: "SimSun" },
  ]);
  Object.assign(window, { queryLocalFonts: query });
  const onChange = await render();
  expect(query).not.toHaveBeenCalled();
  await requestFonts();
  expect(query).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('option[value="Noto Serif CJK SC"]')).toHaveLength(1);
  expect(container.querySelector('option[value="教师本机字体"]')).not.toBeNull();
  expect(container.querySelectorAll('option[value="SimSun"]')).toHaveLength(1);
  expect(fontSelect().value).toBe(DOCUMENT_DEFAULTS.fontFamily);
  expect(onChange).not.toHaveBeenCalled();
  await selectFont("教师本机字体");
  expect(onChange).toHaveBeenLastCalledWith({
    ...DOCUMENT_DEFAULTS,
    fontFamily: "教师本机字体",
  });
});
it("keeps saved fonts selected and common fonts available when local font access is denied", async () => {
  Object.assign(window, {
    queryLocalFonts: vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    }),
  });
  const onChange = await render({ ...DOCUMENT_DEFAULTS, fontFamily: "教师自定义字体" });
  await requestFonts();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("重试");
  expect(fontSelect().value).toBe("教师自定义字体");
  expect(fontSelect().disabled).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  await selectFont("SimSun");
  expect(onChange).toHaveBeenCalledWith({ ...DOCUMENT_DEFAULTS, fontFamily: "SimSun" });
});
it("keeps the font dropdown usable when this browser has no local font API", async () => {
  await render();
  await requestFonts();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("不支持读取本机字体");
  expect(fontSelect().value).toBe(DOCUMENT_DEFAULTS.fontFamily);
  expect(fontSelect().disabled).toBe(false);
});
it("shows loading feedback and restores the chosen font after reading local fonts", async () => {
  let resolveFonts!: (fonts: { family: string }[]) => void;
  Object.assign(window, {
    queryLocalFonts: vi.fn(() => new Promise((resolve) => (resolveFonts = resolve))),
  });
  const onChange = await render({ ...DOCUMENT_DEFAULTS, fontFamily: "SimHei" });
  await requestFonts();
  expect(fontSelect().disabled).toBe(true);
  expect(fontSelect().selectedOptions[0].textContent).toBe("正在读取本机字体…");
  await act(async () => resolveFonts([{ family: "教师本机字体" }]));
  expect(fontSelect().disabled).toBe(false);
  expect(fontSelect().value).toBe("SimHei");
  expect(onChange).not.toHaveBeenCalled();
});
