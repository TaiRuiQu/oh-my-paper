// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import katex from "katex";
import { MarkdownText } from "@/components/markdown-text";
import { MathFormula } from "@/components/math-formula";

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

async function render(text: string) {
  root = createRoot(container);
  await act(async () => root!.render(createElement(MarkdownText, { text })));
}

describe("browser Markdown and KaTeX presentation", () => {
  it("preserves LaTeX on the server and renders it only after browser hydration", async () => {
    const latex = "\\frac{x_1}{2}";
    const props = { text: `**已知** $${latex}$。\n\n| 数值 |\n| --- |\n| $${latex}$ |` };
    const renderMath = vi.spyOn(katex, "render");
    const html = renderToString(createElement(MarkdownText, props));

    expect(renderMath).not.toHaveBeenCalled();
    expect(html).not.toContain('class="katex"');
    expect(html).toContain(latex);
    container.innerHTML = html;
    const onRecoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, createElement(MarkdownText, props), { onRecoverableError });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("strong")?.textContent).toBe("已知");
    expect(container.querySelector("td .katex")).not.toBeNull();
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelectorAll("math")).toHaveLength(2);
    expect(container.querySelector("annotation")?.textContent).toBe(latex);
    expect(container.querySelector("img")).toBeNull();
  });

  it("uses display mode for block equations and keeps malformed formulas readable", async () => {
    await render("$$\na^2+b^2=c^2\n$$\n\n$\\frac{1}{$\n\n$x^2$");

    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.querySelector('math[display="block"]')).not.toBeNull();
    expect(container.querySelector(".katex-error")?.textContent).toBe("\\frac{1}{");
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
  });

  it("updates an existing formula when its text or display mode changes", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(MathFormula, { latex: "x^2", displayMode: false }));
    });
    expect(container.querySelector("annotation")?.textContent).toBe("x^2");
    await act(async () => {
      root!.render(createElement(MathFormula, { latex: "\\sqrt{y}", displayMode: true }));
    });
    expect(container.querySelector("annotation")?.textContent).toBe("\\sqrt{y}");
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
  });

  it("leaves formulas in code untouched and keeps raw HTML and unsafe math commands disabled", async () => {
    await render(
      '`$x^2$`\n\n```text\n$x^2$\n```\n\n<img src="https://example.com/track">\n\n$\\href{javascript:alert(1)}{x}$\n\n$\\includegraphics{https://example.com/track}$',
    );

    expect(container.querySelector("code")?.textContent).toBe("$x^2$");
    expect(container.querySelector("pre code")?.textContent).toBe("$x^2$\n");
    expect(container.querySelectorAll(".math-formula")).toHaveLength(2);
    expect(container.querySelector("a, img, script")).toBeNull();
  });

  it("keeps oversized formulas as text without blocking other formulas", async () => {
    const latex = "x".repeat(10001);
    await render(`$${latex}$\n\n$x^2$`);

    expect(container.querySelector(".math-formula")?.textContent).toBe(latex);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
  });
});
