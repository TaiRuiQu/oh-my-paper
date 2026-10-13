import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunPropertiesOptions,
  type ParagraphChild,
} from "docx";
import type { Nodes, Definition, List } from "mdast";
import {
  type ExportDocument,
  type ExportImage,
  imageDimensions,
  resolveDocumentImage,
  safeLink,
  PAGE_WIDTH_PX,
} from "./document";
export async function exportWord(document: ExportDocument, formulas: Map<string, ExportImage>) {
  const image = (item: ExportImage, formula = false, maxWidth = PAGE_WIDTH_PX) =>
    new ImageRun({
      type: item.type,
      data: item.data,
      transformation: imageDimensions(item, maxWidth),
      altText: {
        title: formula ? "数学公式" : "试卷配图",
        description: item.description,
        name: formula ? "formula" : "material",
      },
      ...(formula && item.baseline
        ? {
            run: {
              position: `${((-item.baseline * imageDimensions(item, maxWidth).width) / item.width) * 0.75}pt`,
            },
          }
        : {}),
    });
  const inline = (
    node: Nodes,
    definitions: Map<string, Definition>,
    style: IRunPropertiesOptions = {},
    maxWidth = PAGE_WIDTH_PX,
  ): ParagraphChild[] => {
    const children = (next = style) =>
      "children" in node
        ? node.children.flatMap((child) => inline(child, definitions, next, maxWidth))
        : [];
    switch (node.type) {
      case "text":
      case "html":
        return [new TextRun({ text: node.value, ...style })];
      case "strong":
        return children({ ...style, bold: true });
      case "emphasis":
        return children({ ...style, italics: true });
      case "delete":
        return children({ ...style, strike: true });
      case "break":
        return [new TextRun({ break: 1 })];
      case "inlineCode":
        return [new TextRun({ text: node.value, ...style, font: "Consolas" })];
      case "math":
      case "inlineMath": {
        const item = formulas.get(document.formulaIds.get(node)!);
        if (!item) throw new Error("Formula image was not generated");
        return [image(item, true, maxWidth)];
      }
      case "image": {
        const item = resolveDocumentImage(document, node.url);
        return item ? [image(item, false, maxWidth)] : [new TextRun(node.alt ?? "配图")];
      }
      case "imageReference": {
        const definition = definitions.get(node.identifier),
          item = definition && resolveDocumentImage(document, definition.url);
        return item ? [image(item, false, maxWidth)] : [new TextRun(node.alt ?? "配图")];
      }
      case "definition":
        return [];
      case "link": {
        const url = safeLink(node.url);
        return url ? [new ExternalHyperlink({ link: url, children: children() })] : children();
      }
      case "linkReference": {
        const url = definitions.get(node.identifier)?.url;
        return url && safeLink(url)
          ? [new ExternalHyperlink({ link: url, children: children() })]
          : children();
      }
      default:
        return children();
    }
  };
  const headingLevels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  const blocks = (
    node: Nodes,
    definitions: Map<string, Definition>,
    depth = 0,
  ): (Paragraph | Table)[] => {
    switch (node.type) {
      case "root":
      case "blockquote":
      case "listItem":
        return node.children.flatMap((child) => blocks(child, definitions, depth));
      case "paragraph":
        return [
          new Paragraph({
            children: inline(node, definitions),
            spacing: { after: 120 },
            widowControl: true,
            indent: depth ? { left: depth * 360 } : undefined,
          }),
        ];
      case "heading":
        return [
          new Paragraph({
            children: inline(node, definitions),
            heading: headingLevels[node.depth - 1],
            keepNext: true,
          }),
        ];
      case "math":
        return [
          new Paragraph({
            children: inline(node, definitions),
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            keepLines: true,
          }),
        ];
      case "list":
        return list(node, definitions, depth);
      case "table":
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: node.children.map(
              (row, index) =>
                new TableRow({
                  tableHeader: index === 0,
                  cantSplit: true,
                  children: row.children.map(
                    (cell) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: cell.children.flatMap((child) =>
                              inline(
                                child,
                                definitions,
                                { bold: index === 0 },
                                PAGE_WIDTH_PX / row.children.length - 16,
                              ),
                            ),
                          }),
                        ],
                        margins: { top: 80, bottom: 80, left: 80, right: 80 },
                      }),
                  ),
                }),
            ),
          }),
        ];
      case "code":
        return node.value.split("\n").map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Consolas", size: 20 })],
              spacing: { after: 0 },
            }),
        );
      case "thematicBreak":
        return [
          new Paragraph({
            border: { bottom: { color: "808080", style: BorderStyle.SINGLE, size: 4 } },
          }),
        ];
      case "definition":
        return [];
      default: {
        const content = inline(node, definitions);
        return content.length ? [new Paragraph({ children: content })] : [];
      }
    }
  };
  function list(
    node: List,
    definitions: Map<string, Definition>,
    depth: number,
  ): (Paragraph | Table)[] {
    return node.children.flatMap((item, index) => {
      const prefix =
        item.checked !== undefined && item.checked !== null
          ? item.checked
            ? "☑ "
            : "☐ "
          : node.ordered
            ? `${(node.start ?? 1) + index}. `
            : "• ";
      const result: (Paragraph | Table)[] = [];
      const first = item.children[0];
      if (first?.type === "paragraph")
        result.push(
          new Paragraph({
            children: [new TextRun(prefix), ...inline(first, definitions)],
            indent: { left: (depth + 1) * 360, hanging: 260 },
            spacing: { after: 80 },
          }),
        );
      else result.push(new Paragraph({ text: prefix, indent: { left: (depth + 1) * 360 } }));
      for (const child of item.children.slice(first?.type === "paragraph" ? 1 : 0))
        result.push(...blocks(child, definitions, depth + 1));
      return result;
    });
  }
  const children = document.parts.flatMap((part) => {
    if (part.kind === "markdown") return blocks(part.tree, part.definitions);
    if (part.kind === "image")
      return [
        new Paragraph({
          children: [image(document.images.get(part.key)!)],
          spacing: { before: 120, after: 120 },
          keepLines: true,
        }),
      ];
    return [
      new Paragraph({
        text: part.text,
        heading: part.level === 1 ? HeadingLevel.TITLE : headingLevels[part.level - 2],
        alignment: part.level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
        keepNext: true,
        spacing: { before: part.level === 1 ? 0 : 180, after: 120 },
      }),
    ];
  });
  const file = new Document({
    title: document.title,
    creator: "Oh My Paper",
    description: "已解析试卷，数学公式以图片保存",
    styles: {
      default: {
        document: {
          run: { font: { name: "Calibri", eastAsia: "宋体" }, size: 22, color: "111111" },
          paragraph: { spacing: { line: 340, after: 120 } },
        },
        title: { run: { size: 36, bold: true, color: "111111" } },
        heading1: { run: { size: 26, bold: true, color: "111111" } },
        heading2: { run: { size: 22, bold: true, color: "111111" } },
        heading3: { run: { size: 22, bold: true, color: "111111" } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(file);
}
