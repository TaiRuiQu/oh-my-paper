import type { Nodes, Root } from "mdast";
import { unified, type PluggableList } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkDisplayMath } from "./remark-display-math";
import { remarkParentheticalMath } from "./remark-parenthetical-math";

/** Keep image discovery and MarkdownText on the same Markdown/math grammar. */
export const markdownRemarkPlugins: PluggableList = [
  remarkGfm,
  remarkMath,
  remarkParentheticalMath,
  remarkDisplayMath,
];
const processor = unified().use(remarkParse).use(markdownRemarkPlugins).freeze();

/** Only actual rendered image nodes suppress a gallery image. Links, code and math are text. */
export function markdownImageUrls(text: string): Set<string> {
  const tree = processor.runSync(processor.parse(text), { value: text }) as Root;
  const definitions = new Map<string, string>();
  const images = new Set<string>();
  const walk = (node: Nodes, visit: (node: Nodes) => void) => {
    visit(node);
    if ("children" in node) for (const child of node.children) walk(child, visit);
  };
  walk(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    const url =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier)
          : undefined;
    // MarkdownText only displays these controlled private-image URLs.
    if (url && /^\/api\/platform\/assets\/[a-f0-9-]{36}$/.test(url)) images.add(url);
  });
  return images;
}

export function galleryImagesOutsideMarkdown(images: string[], texts: string[]): string[] {
  if (!images.length) return images;
  const embedded = new Set(texts.flatMap((text) => [...markdownImageUrls(text)]));
  return images.filter((url) => !embedded.has(url));
}
