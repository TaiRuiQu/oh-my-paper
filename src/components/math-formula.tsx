"use client";

import { useEffect, useRef } from "react";
import katex from "katex";

export function MathFormula({ latex, displayMode }: { latex: string; displayMode: boolean }) {
  const container = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    element.textContent = latex;
    if (latex.length > 10000) return;

    try {
      // Effects run only in the browser, including on the initial server-rendered page.
      katex.render(latex, element, {
        displayMode,
        throwOnError: false,
        trust: false,
        strict: "ignore",
        maxSize: 100,
        maxExpand: 1000,
      });
    } catch {
      element.textContent = latex;
    }
  }, [latex, displayMode]);

  return (
    <span className={displayMode ? "math-formula math-display" : "math-formula"}>
      <span ref={container}>{latex}</span>
    </span>
  );
}
