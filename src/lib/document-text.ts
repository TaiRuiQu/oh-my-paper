import katex from "katex";
export function escapePrintText(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
/** KaTeX's HTML uses its bundled math fonts; MathML remains available to screen readers. */
export function renderPrintRichText(value: string): string {
  const expression = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  let output = "",
    offset = 0;
  for (const match of value.matchAll(expression)) {
    output += escapePrintText(value.slice(offset, match.index));
    const math = match[1] ?? match[2] ?? match[3] ?? match[4];
    output += katex.renderToString(math, {
      output: "htmlAndMathml",
      displayMode: !!(match[1] ?? match[4]),
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
    });
    offset = match.index! + match[0].length;
  }
  return output + escapePrintText(value.slice(offset));
}
