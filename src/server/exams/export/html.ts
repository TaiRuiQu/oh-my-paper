import "server-only";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import katex from "katex";
import type { Nodes, Definition } from "mdast";
import {
  type ExportDocument,
  imageDimensions,
  resolveDocumentImage,
  safeLink,
  PAGE_WIDTH_PX,
  PRINT_LAYOUT,
  SHEET_WIDTH_PX,
  SHEET_HEIGHT_PX,
} from "./document";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
let styles: Promise<string> | undefined;
async function exportStyles() {
  styles ??= (async () => {
    // Resolve from the application root; Turbopack treats require.resolve(CSS) as a CSS import.
    const path = join(process.cwd(), "node_modules/katex/dist/katex.min.css");
    let css = await readFile(path, "utf8");
    const urls = [
      ...new Set(
        Array.from(css.matchAll(/url\(([^)]+)\)/g), (match) => match[1].replace(/["']/g, "")),
      ),
    ];
    for (const url of urls) {
      const data = await readFile(join(dirname(path), url));
      const mime = extname(url) === ".ttf" ? "font/ttf" : `font/${extname(url).slice(1)}`;
      css = css.split(url).join(`data:${mime};base64,${data.toString("base64")}`);
    }
    const printFont = await readFile(join(process.cwd(), "assets/fonts/nsimsun.ttf"));
    return `${css}\n@font-face{font-family:"NSimSun";src:url("data:font/ttf;base64,${printFont.toString("base64")}") format("truetype");font-style:normal;font-weight:400;font-display:block}`;
  })();
  return styles;
}
export async function exportHtml(document: ExportDocument) {
  const formula = (node: Nodes) => {
    const id = document.formulaIds.get(node)!;
    const item = document.formulas.get(id)!;
    const markup =
      item.latex.length > 10_000
        ? escape(item.latex)
        : katex.renderToString(item.latex, {
            displayMode: item.display,
            throwOnError: false,
            trust: false,
            strict: "ignore",
            maxSize: 100,
            maxExpand: 1000,
            output: "html",
          });
    return `<${item.display ? "div" : "span"} class="formula-line${item.display ? " display-formula" : ""}"><span data-formula="${id}" class="export-formula">${markup}<span class="formula-baseline"></span></span></${item.display ? "div" : "span"}>`;
  };
  const image = (key: string, alt: string) => {
    const item = resolveDocumentImage(document, key);
    if (!item) return escape(alt);
    const dimensions = imageDimensions(item);
    return `<img src="data:image/${item.type === "jpg" ? "jpeg" : "png"};base64,${item.data.toString("base64")}" alt="${escape(alt)}" style="width:${dimensions.width}px;max-width:100%;height:auto">`;
  };
  const render = (node: Nodes, definitions: Map<string, Definition>): string => {
    const children = () =>
      "children" in node ? node.children.map((child) => render(child, definitions)).join("") : "";
    switch (node.type) {
      case "root":
        return children();
      case "paragraph":
        return `<p>${children()}</p>`;
      case "text":
        return escape(node.value);
      case "strong":
        return `<strong>${children()}</strong>`;
      case "emphasis":
        return `<em>${children()}</em>`;
      case "delete":
        return `<del>${children()}</del>`;
      case "break":
        return "<br>";
      case "inlineCode":
        return `<code>${escape(node.value)}</code>`;
      case "code":
        return `<pre><code>${escape(node.value)}</code></pre>`;
      case "heading":
        return `<h${node.depth}>${children()}</h${node.depth}>`;
      case "blockquote":
        return `<blockquote>${children()}</blockquote>`;
      case "list":
        return `<${node.ordered ? `ol start="${node.start ?? 1}"` : "ul"}>${children()}</${node.ordered ? "ol" : "ul"}>`;
      case "listItem":
        return `<li>${node.checked === null || node.checked === undefined ? "" : node.checked ? "☑ " : "☐ "}${children()}</li>`;
      case "table":
        return `<table>${node.children.map((row, index) => `<${index === 0 ? "thead" : "tbody"}><tr>${row.children.map((cell) => `<${index === 0 ? "th" : "td"}>${render(cell, definitions)}</${index === 0 ? "th" : "td"}>`).join("")}</tr></${index === 0 ? "thead" : "tbody"}>`).join("")}</table>`;
      case "tableCell":
      case "tableRow":
        return children();
      case "thematicBreak":
        return "<hr>";
      case "math":
      case "inlineMath":
        return formula(node);
      case "image":
        return image(node.url, node.alt ?? "配图");
      case "imageReference": {
        const definition = definitions.get(node.identifier);
        return definition ? image(definition.url, node.alt ?? "配图") : escape(node.alt ?? "");
      }
      case "link": {
        const url = safeLink(node.url);
        return url ? `<a href="${escape(url)}">${children()}</a>` : children();
      }
      case "linkReference": {
        const url = definitions.get(node.identifier)?.url;
        return url && safeLink(url) ? `<a href="${escape(url)}">${children()}</a>` : children();
      }
      case "html":
        return escape(node.value);
      case "definition":
        return "";
      default:
        return children();
    }
  };
  const body = document.parts
    .map((part) =>
      part.kind === "heading"
        ? `<header class="paper-header"><h${part.level}>${escape(part.text)}</h${part.level}>${document.totalScore === null || document.totalScore === undefined ? "" : `<p style="text-align:right;margin:1pt 0">满分 ${document.totalScore} 分</p>`}</header>`
        : part.kind === "image"
          ? `<p class="material">${image(part.key, document.images.get(part.key)!.description)}</p>`
          : part.role === "choices"
            ? `<div class="choices${part.choiceColumns === 4 ? " choices-four" : ""}">${render(part.tree, part.definitions)}</div>`
            : part.role === "section"
              ? `<div class="section-instructions">${render(part.tree, part.definitions)}</div>`
              : part.role === "question"
                ? `<div class="question-stem">${render(part.tree, part.definitions)}</div>`
                : render(part.tree, part.definitions),
    )
    .join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(document.title)}</title><style>${await exportStyles()}
@page{size:${PRINT_LAYOUT.widthMm}mm ${PRINT_LAYOUT.heightMm}mm;margin:${PRINT_LAYOUT.marginMm}mm}*{box-sizing:border-box}body{margin:0;background:white;color:#111;font:5.5pt/1.45 "NSimSun","Noto Serif CJK SC","Noto Sans CJK SC",serif}.print-source{width:${PAGE_WIDTH_PX}px}.paper-page{position:relative;width:${SHEET_WIDTH_PX}px;height:${SHEET_HEIGHT_PX}px;break-after:page;page-break-after:always;padding-bottom:10px}.paper-page:last-child{break-after:auto;page-break-after:auto}.paper-columns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:${PRINT_LAYOUT.gapMm}mm;height:100%}.paper-column{min-width:0;min-height:0;display:flow-root}.paper-header{width:calc(50% - ${PRINT_LAYOUT.gapMm / 2}mm);padding:2pt 5pt;border-top:0.5pt solid #111;border-bottom:0.5pt solid #111;margin-bottom:4pt}.paper-page>.paper-header{position:absolute;top:0;left:0}.paper-header h1{font-size:8pt;text-align:center;margin:0;line-height:1.3}.paper-footer{position:absolute;right:0;bottom:0;font-size:5pt}.section-instructions{font-weight:bold;margin-top:5pt;break-after:avoid}.question-stem{margin-top:5pt}.choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1pt 4pt}.choices p{margin:1pt 0}.choices-four{grid-template-columns:repeat(4,minmax(0,1fr))}.choices-wide{grid-template-columns:1fr}h2,h3,h4{font-size:6pt;margin:4pt 0 2pt}p{margin:2pt 0;orphans:2;widows:2;overflow-wrap:anywhere}img{display:inline-block;object-fit:contain;break-inside:avoid;max-height:440px}.material{text-align:center;margin:3pt 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:5pt/1.4 monospace}table{width:100%;table-layout:fixed;border-collapse:collapse;margin:4pt 0}th,td{border:0.4pt solid #555;padding:2pt;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}a{color:inherit;text-decoration:none}blockquote{margin:3pt 0;padding:0 4pt;border-left:0.5pt solid #888}.export-formula{display:inline-block;padding:1px;max-width:100%;line-height:normal}.formula-baseline{display:inline-block;width:0;height:0}.display-formula{text-align:center;margin:4pt 0;break-inside:avoid}.katex-display{margin:0}.katex-error{white-space:pre-wrap;overflow-wrap:anywhere}.katex{white-space:nowrap;font-size:1em}li>p{margin:1pt 0}ol,ul{padding-left:10pt;margin:3pt 0}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main class="print-source">${body}</main></body></html>`;
}
