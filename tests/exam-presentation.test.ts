import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createExamContentRenderer } from "@/components/exams/content-renderer";
import type { ContentBlock, FigureAsset } from "@/contracts/exams";

const region = { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const figure: ContentBlock = {
  type: "figure",
  caption: "原图说明",
  region,
  contaminated: false,
  assetId: "figure-1",
};
const asset: FigureAsset = {
  id: "figure-1",
  caption: "原图说明",
  region,
  contaminated: false,
  evidenceKey: "evidence.png",
  cleanKey: "clean.png",
  role: "question",
};
const source = "data:image/svg+xml;base64,PHN2Zy8+";
const fileURL = (key: string) => `/api/exams/example/files/${key}`;

function render(blocks: ContentBlock[], assets: FigureAsset[] = []) {
  const renderer = createExamContentRenderer({ images: { "x+1": source }, assets, fileURL });
  return renderToStaticMarkup(createElement("div", null, renderer.blocks(blocks, "question")));
}

describe("exam content presentation", () => {
  it("preserves Markdown, formulas, and table content together", () => {
    const html = render([
      { type: "text", text: "**题干** $x+1$" },
      { type: "math", latex: "missing" },
      { type: "table", rows: [["结果", "$x+1$"]] },
    ]);
    expect(html).toContain("<strong>题干</strong>");
    expect(html).toContain("math-fallback");
    expect(html).toContain("missing");
    expect(html).toContain("<table>");
    expect(html.match(/class="math-image"/g)).toHaveLength(2);
  });

  it("shows a clean figure and its original caption", () => {
    const html = render([figure], [asset]);
    expect(html).toContain(fileURL("clean.png"));
    expect(html).toContain("<figcaption>原图说明</figcaption>");
  });

  it("keeps evidence accessible when a clean figure is unavailable", () => {
    const html = render([figure], [{ ...asset, cleanKey: null, contaminated: true }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("配图需核对");
    expect(html).toContain(fileURL("evidence.png"));
  });
});
