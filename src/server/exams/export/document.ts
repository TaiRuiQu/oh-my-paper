import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, Nodes, Definition, PhrasingContent } from "mdast";
import sharp from "sharp";
import type { Exam } from "@/contracts/exams";
import { materialKey, examMaterials } from "@/lib/exam-materials";
import { remarkParentheticalMath } from "@/lib/remark-parenthetical-math";
import { AppError } from "@/server/errors";

export type ExportImage = {
  data: Buffer;
  width: number;
  height: number;
  type: "png" | "jpg";
  description: string;
  baseline?: number;
};
export type ExportPart =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "markdown"; tree: Root; definitions: Map<string, Definition> }
  | { kind: "image"; key: string };
export type ExportFormula = { id: string; latex: string; display: boolean };
export type ExportDocument = {
  title: string;
  taskId?: string;
  parts: ExportPart[];
  images: Map<string, ExportImage>;
  formulas: Map<string, ExportFormula>;
  formulaIds: WeakMap<Nodes, string>;
};
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkParentheticalMath);
export const PAGE_WIDTH_PX = 642; // A4 with 20 mm side margins, at 96 dpi.
function visit(node: Nodes, callback: (node: Nodes) => void) {
  callback(node);
  if ("children" in node) node.children.forEach((child) => visit(child, callback));
}
export async function buildExportDocument(
  exam: Exam,
  directory: string,
  signal?: AbortSignal,
  taskId?: string,
): Promise<ExportDocument> {
  signal?.throwIfAborted();
  const document: ExportDocument = {
    title: exam.name,
    taskId,
    parts: [],
    images: new Map(),
    formulas: new Map(),
    formulaIds: new WeakMap(),
  };
  const formulaKeys = new Map<string, string>();
  const heading = (level: 1 | 2 | 3 | 4, text: string) =>
    document.parts.push({ kind: "heading", level, text });
  const markdown = (text: string, label?: string) => {
    if (!text.trim() && !label) return;
    const tree = parser.parse(text),
      definitions = new Map<string, Definition>();
    if (label) {
      const prefix: PhrasingContent[] = [
        { type: "strong", children: [{ type: "text", value: label }] },
        { type: "text", value: " " },
      ];
      const firstPosition = tree.children.findIndex((node) => node.type !== "definition");
      const first = tree.children[firstPosition];
      if (first?.type === "paragraph" || first?.type === "heading") {
        tree.children[firstPosition] = {
          type: "paragraph",
          children: [...prefix, ...first.children],
        };
      } else {
        // Preserve block formulas, tables and lists instead of flattening their structure.
        tree.children.unshift({ type: "paragraph", children: prefix });
      }
    }
    visit(tree, (node) => {
      if (node.type === "definition") definitions.set(node.identifier, node);
      if (node.type !== "math" && node.type !== "inlineMath") return;
      const display = node.type === "math",
        key = `${display}:${node.value}`;
      let id = formulaKeys.get(key);
      if (!id) {
        id = `formula-${document.formulas.size}`;
        formulaKeys.set(key, id);
        document.formulas.set(id, { id, latex: node.value, display });
      }
      document.formulaIds.set(node, id);
    });
    document.parts.push({ kind: "markdown", tree, definitions });
  };
  const score = (value: number | null) => (value === null ? "" : `（${value} 分）`);
  heading(1, exam.name);
  if (exam.totalScore !== null) markdown(`总分：${exam.totalScore} 分`);
  let position = 0;
  for (const section of exam.sections) {
    heading(2, `${section.number}、${section.title}${score(section.score)}`);
    markdown(section.description);
    for (const question of section.questions) {
      heading(3, `第 ${question.number} 题${score(question.score)}`);
      markdown(question.description);
      question.materials.forEach((_, index) =>
        document.parts.push({ kind: "image", key: materialKey(position, index) }),
      );
      question.subquestions.forEach((part, partPosition) => {
        markdown(part.description, `${part.number}${score(part.score)}`);
        part.materials.forEach((_, index) =>
          document.parts.push({ kind: "image", key: materialKey(position, index, partPosition) }),
        );
      });
      position++;
    }
  }
  // Only published crops in this exam's own directory can become document images.
  for (const material of examMaterials(exam)) {
    signal?.throwIfAborted();
    const data = await readFile(join(directory, material.key));
    const info = await sharp(data, { limitInputPixels: 45_000_000 }).metadata();
    if (!info.width || !info.height || info.format !== "jpeg")
      throw new AppError("试卷配图无效，无法导出。", "EXPORT_IMAGE_INVALID", 422);
    document.images.set(material.key, {
      data,
      width: info.width,
      height: info.height,
      type: "jpg",
      description: `第 ${material.questionNumber} 题${material.subquestionNumber ?? ""}的配图`,
    });
  }
  return document;
}
export function resolveDocumentImage(document: ExportDocument, url: string) {
  // Markdown may reference a published crop, but never other exams or remote URLs.
  if (document.images.has(url)) return document.images.get(url);
  for (const prefix of [
    `/api/exams/${document.taskId}/files/`,
    `/api/admin/exams/${document.taskId}/files/`,
  ]) {
    if (document.taskId && url.startsWith(prefix))
      return document.images.get(url.slice(prefix.length));
  }
  return undefined;
}
export function imageDimensions(image: ExportImage, maxWidth = PAGE_WIDTH_PX) {
  const scale = Math.min(1, maxWidth / image.width, 820 / image.height);
  return { width: image.width * scale, height: image.height * scale };
}
export function safeLink(url: string) {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}
