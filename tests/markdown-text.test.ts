import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "@/components/markdown-text";

describe("recognition Markdown and LaTeX presentation", () => {
  it("renders formulas next to Markdown emphasis and inside tables without changing LaTeX", () => {
    const source = "data:image/svg+xml;base64,PHN2Zy8+";
    const latex = "\\frac{x_1}{2}";
    const html = renderToStaticMarkup(
      createElement(MarkdownText, {
        text: `**已知** $${latex}$。\n\n| 数值 |\n| --- |\n| $${latex}$ |`,
        images: { [latex]: source },
      }),
    );
    expect(html).toContain("<strong>已知</strong>");
    expect(html).toContain("<table>");
    expect(html.match(/class="math-image"/g)).toHaveLength(2);
    expect(html).toContain('alt="\\frac{x_1}{2}"');
  });
  it("renders display equations and preserves a readable fallback for unavailable formulas", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, {
        text: "$$\na^2+b^2=c^2\n$$\n\n$x_{missing}$",
        images: { "\na^2+b^2=c^2\n": "data:image/svg+xml;base64,PHN2Zy8+" },
      }),
    );
    expect(html).toContain("math-display-image");
    expect(html).toContain("x_{missing}");
    expect(html).not.toContain("$x");
  });
});
