// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it } from "vitest";
import type { Paper } from "@/contracts/platform";
import { PaperSharedReading } from "@/components/platform/paper-reading";
import { paperReadingAssetUrls } from "@/lib/paper-reading";
const url = "/api/platform/assets/00000000-0000-4000-8000-000000000001";
const paper = {
  id: "paper",
  instructions: "按材料作答",
  layout: {
    paperSize: "A4",
    columns: 1,
    textBlocks: [
      { id: "header", text: "卷首材料" },
      { id: "q-anchor", beforeQuestionId: "q1", text: `第一题原始锚材料 ![共享图片](${url})` },
      { id: "item-anchor", beforeQuestionId: "item2", text: "第二题项目锚材料" },
      { id: "missing-anchor", beforeQuestionId: "removed-question", text: "无有效锚材料仍需保留" },
    ],
  },
  items: [
    { id: "item1", questionId: "q1" },
    { id: "item2", questionId: "q2" },
  ],
} as unknown as Paper;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("keeps original-question and item anchors directly before their question, with unanchored material at the start", async () => {
  await act(async () =>
    root.render(
      <>
        <PaperSharedReading paper={paper} context="卷首" />
        <PaperSharedReading paper={paper} beforeItemId="item1" context="第一题" />
        <p>第一题正文</p>
        <PaperSharedReading paper={paper} beforeItemId="item2" context="第二题" />
        <p>第二题正文</p>
      </>,
    ),
  );
  const text = container.textContent!;
  expect(text.indexOf("按材料作答")).toBeLessThan(text.indexOf("第一题原始锚材料"));
  expect(text.indexOf("第一题原始锚材料")).toBeLessThan(text.indexOf("第一题正文"));
  expect(text.indexOf("第一题正文")).toBeLessThan(text.indexOf("第二题项目锚材料"));
  expect(text.indexOf("第二题项目锚材料")).toBeLessThan(text.indexOf("第二题正文"));
  expect(text.match(/无有效锚材料仍需保留/g)).toHaveLength(1);
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
});
it("does not create empty material panels or move another question's reading into a missing item", async () => {
  await act(async () =>
    root.render(<PaperSharedReading paper={paper} beforeItemId="missing-item" context="缺失题" />),
  );
  expect(container.innerHTML).toBe("");
  await act(async () =>
    root.render(
      <PaperSharedReading
        paper={{ ...paper, instructions: "", layout: { paperSize: "A4", columns: 1 } }}
        context="空"
      />,
    ),
  );
  expect(container.innerHTML).toBe("");
});
it("discovers only true reading images and excludes answers, ordinary links and code", () => {
  expect(
    paperReadingAssetUrls({
      ...paper,
      instructions: `[链接](${url})\n\n\`![代码](${url})\``,
      layout: { paperSize: "A4", columns: 1, textBlocks: [] },
    }),
  ).toEqual([]);
  expect(paperReadingAssetUrls(paper)).toEqual([url]);
});
