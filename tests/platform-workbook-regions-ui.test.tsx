// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkbookCrop } from "@/components/platform/workbook-crop";
import type { Box, Paper } from "@/contracts/platform";
import type { ScanUploadPage } from "@/contracts/uploads";
vi.mock("next/image", () => ({ default: () => null }));
const paper = { items: [{ id: "q" }, { id: "q2" }] } as Paper;
const files = [
  { name: "page1", assetUrl: "/api/platform/assets/page1" },
  { name: "page2", assetUrl: "/api/platform/assets/page2" },
] as ScanUploadPage[];
const initial = { itemId: "q", page: 1, x: 0, y: 0, width: 0.4, height: 0.3 };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
let saved: (Box & { itemId: string })[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(disabled = false) {
  function Harness() {
    const [boxes, setBoxes] = useState([initial]);
    saved = boxes;
    return createElement(WorkbookCrop, { paper, files, boxes, onChange: setBoxes, disabled });
  }
  await act(async () => root.render(createElement(Harness)));
}
it("adds another region for a previously cropped question and keeps the existing region", async () => {
  await render();
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("添加第 1"),
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(saved).toHaveLength(2);
  expect(saved[0]).toEqual(initial);
  expect(saved[1]).toMatchObject({ itemId: "q", page: 1 });
  expect(host.textContent).toContain("2 个区域");
  const operation = host.querySelectorAll("select")[2];
  expect([...operation.options].map((o) => o.textContent)).toEqual([
    "添加续答区域",
    "重画区域 1 · 第 1 页",
    "重画区域 2 · 第 1 页",
  ]);
});
it("allows continuation regions on a different page and locks all editing while uploading", async () => {
  await render();
  const page = host.querySelector("select")!;
  await act(async () => {
    page.value = "2";
    page.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => [...host.querySelectorAll("button")][0].click());
  expect(saved.map((b) => b.page)).toEqual([1, 2]);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render(true);
  expect(
    [...host.querySelectorAll("button,select")].every((el) => (el as HTMLInputElement).disabled),
  ).toBe(true);
});
