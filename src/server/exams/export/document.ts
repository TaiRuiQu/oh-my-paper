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
  | {
      kind: "markdown";
      tree: Root;
      definitions: Map<string, Definition>;
      role?: "section" | "question" | "choices";
      choiceColumns?: 2 | 4;
    }
  | { kind: "image"; key: string };
export type ExportFormula = { id: string; latex: string; display: boolean };
export type ExportDocument = {
  title: string;
  totalScore?: number | null;
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
// The reference is a 210 × 148 mm landscape sheet with four compact columns.
export const PRINT_LAYOUT = {
  widthMm: 210,
  heightMm: 148,
  marginMm: 5,
  gapMm: 3.5,
  columns: 4,
} as const;
export const SHEET_WIDTH_PX = ((PRINT_LAYOUT.widthMm - PRINT_LAYOUT.marginMm * 2) * 96) / 25.4;
export const SHEET_HEIGHT_PX = ((PRINT_LAYOUT.heightMm - PRINT_LAYOUT.marginMm * 2) * 96) / 25.4;
export const PAGE_WIDTH_PX =
  (SHEET_WIDTH_PX - ((PRINT_LAYOUT.columns - 1) * PRINT_LAYOUT.gapMm * 96) / 25.4) /
  PRINT_LAYOUT.columns;

export function splitChoices(text: string) {
  const matches = [...text.matchAll(/(?:^|\s)([A-D])[.．、)）]\s*/g)];
  if (matches.length !== 4 || matches.map((item) => item[1]).join("") !== "ABCD")
    return { stem: text, choices: [] as string[] };
  return {
    stem: text.slice(0, matches[0].index).trimEnd(),
    choices: matches.map(
      (match, index) =>
        `${match[1]}. ${text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length).trim()}`,
    ),
  };
}
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
    totalScore: exam.totalScore,
    taskId,
    parts: [],
    images: new Map(),
    formulas: new Map(),
    formulaIds: new WeakMap(),
  };
  const formulaKeys = new Map<string, string>();
  const heading = (level: 1 | 2 | 3 | 4, text: string) =>
    document.parts.push({ kind: "heading", level, text });
  const markdown = (text: string, label?: string, role?: "section" | "question" | "choices") => {
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
    const choiceColumns =
      role === "choices" &&
      tree.children.every((node) => {
        let size = 0;
        visit(node, (child) => {
          if (child.type === "text") size += child.value.length;
          if (child.type === "inlineMath")
            size += child.value.replace(/\\[a-zA-Z]+/g, "x").replace(/[{}_^]/g, "").length;
        });
        return size <= 8;
      })
        ? 4
        : 2;
    document.parts.push({
      kind: "markdown",
      tree,
      definitions,
      role,
      ...(role === "choices" ? { choiceColumns } : {}),
    });
  };
  const score = (value: number | null) => (value === null ? "" : `（${value} 分）`);
  heading(1, exam.name);
  let position = 0;
  for (const section of exam.sections) {
    markdown(
      section.description,
      `${section.number}、${section.title}${score(section.score)}：`,
      "section",
    );
    for (const question of section.questions) {
      const { stem, choices } = splitChoices(question.description);
      markdown(stem, `${question.number}.${score(question.score)}`, "question");
      question.materials.forEach((_, index) =>
        document.parts.push({ kind: "image", key: materialKey(position, index) }),
      );
      if (choices.length) markdown(choices.join("\n\n"), undefined, "choices");
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
  const scale = Math.min(1, maxWidth / image.width, SHEET_HEIGHT_PX / image.height);
  return { width: image.width * scale, height: image.height * scale };
}
export function safeLink(url: string) {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}
