import "server-only";
import MathJax from "mathjax";
import type { ContentBlock, DigitalExam } from "@/contracts/exams";

let ready: Promise<unknown> | undefined;
const cache = new Map<string, string>();
// MathJax has shared internal state; serialize conversions across requests.
let pending: Promise<unknown> = Promise.resolve();
export async function renderExamMath(exam: DigitalExam): Promise<Record<string, string>> {
  const blocks: ContentBlock[] = [...exam.questions.flatMap((q) => [...q.blocks, ...q.options.flatMap((o) => o.blocks), ...q.parts.flatMap((p) => p.blocks)]),
    ...exam.materials.flatMap((m) => m.blocks), ...exam.annotations.flatMap((a) => a.blocks)];
  return renderMathBlocks(blocks);
}

export function renderMathText(texts: string[]) { return renderMathBlocks(texts.map((text) => ({ type: "text", text }))); }

async function renderMathBlocks(blocks: ContentBlock[]): Promise<Record<string, string>> {
  const latex = new Set(blocks.flatMap((block) => block.type === "math" ? [block.latex] : block.type === "text"
    ? Array.from(block.text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g), (match) => match[1] ?? match[2]) : []));
  const result: Record<string, string> = Object.create(null);
  const work = pending.then(async () => {
    if (!latex.size) return;
    ready ??= MathJax.init({ loader: { load: ["input/tex", "output/svg"] },
      tex: { packages: ["base", "ams"], maxBuffer: 10000, maxMacros: 1000 },
      // MathJax 4 otherwise splits inline math into several sibling SVGs.
      // A data-URL image must contain the entire expression in one SVG.
      svg: { fontCache: "none", linebreaks: { inline: false } } });
    try { await ready; } catch { ready = undefined; return; }
    for (const formula of [...latex].slice(0, 500)) {
      if (formula.length > 10000) continue;
      try {
        if (!cache.has(formula)) {
          const node = await MathJax.tex2svgPromise(formula, { display: false });
          const svg = MathJax.startup.adaptor.outerHTML(MathJax.startup.adaptor.firstChild(node));
          if (cache.size >= 500) cache.clear();
          cache.set(formula, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
        }
        result[formula] = cache.get(formula)!;
      } catch { /* Preserve the original LaTeX as a readable fallback. */ }
    }
  });
  pending = work.catch(() => undefined);
  await work;
  // React Server Components require a plain object at this boundary.
  // Object spread also defines special keys without invoking prototype setters.
  return { ...result };
}
