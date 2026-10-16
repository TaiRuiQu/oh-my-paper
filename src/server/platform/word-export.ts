import "server-only";
import sharp from "sharp";
import { renderStudentIdentitySvg } from "@/lib/student-identity";
import katex from "katex";
import { mml2omml } from "mathml2omml";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  ImportedXmlComponent,
  LineRuleType,
  Math as WordMath,
  Packer,
  PageOrientation,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IContext,
  type IParagraphOptions,
  type IXmlableObject,
  type ParagraphChild,
} from "docx";
import type { Paper } from "@/contracts/platform";
import {
  orderedDocumentBlocks,
  DOCUMENT_DEFAULTS,
  DOCUMENT_COLUMN_GAP_MM,
  DOCUMENT_FOOTER_MM,
  documentAnswerSpaceMm,
} from "@/lib/document-layout";
import type { ExportAssetLoader } from "./export-assets";
import { renderPrintRichText } from "@/lib/document-text";

class Equation extends WordMath {
  private readonly xml: ImportedXmlComponent;
  constructor(expression: string, displayMode: boolean) {
    super({ children: [] });
    const rendered = katex.renderToString(expression, {
      output: "mathml",
      displayMode,
      trust: false,
      maxExpand: 1000,
    });
    const mathml = rendered.match(/<math[\s\S]*<\/math>/)![0];
    this.xml = ImportedXmlComponent.fromXmlString(mml2omml(mathml));
  }
  override prepForXml(context: IContext): IXmlableObject {
    // fromXmlString returns a document wrapper around the imported root element.
    return (Object.values(this.xml.prepForXml(context)!)[0] as IXmlableObject[])[0];
  }
}

function richRuns(text: string): ParagraphChild[] {
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  const runs: ParagraphChild[] = [];
  const plain = (value: string) =>
    value.split("\n").forEach((line, index) => {
      runs.push(new TextRun({ text: line, ...(index ? { break: 1 } : {}) }));
    });
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    plain(text.slice(offset, match.index));
    try {
      runs.push(
        new Equation(match[1] ?? match[2] ?? match[3] ?? match[4], !!(match[1] ?? match[4])),
      );
    } catch {
      // Invalid source formulas remain visible and editable instead of losing content.
      plain(match[0]);
    }
    offset = match.index! + match[0].length;
  }
  plain(text.slice(offset));
  return runs;
}

export async function renderPaperWord(paper: Paper, loadAsset: ExportAssetLoader): Promise<Buffer> {
  const layout = paper.layout;
  const twips = (mm: number) => Math.round((mm * 1440) / 25.4);
  const [short, long] = layout.paperSize === "A3" ? [297, 420] : [210, 297];
  const margin = layout.marginMm ?? DOCUMENT_DEFAULTS.marginMm;
  const paragraph = (text: string, options: IParagraphOptions = {}) =>
    new Paragraph({
      children: richRuns(text),
      spacing: {
        after: 0,
        line: Math.round((layout.lineHeight ?? DOCUMENT_DEFAULTS.lineHeight) * 240),
        lineRule: LineRuleType.AUTO,
      },
      ...options,
    });
  const header: Paragraph[] = [];
  if (paper.kind === "HOMEWORK") {
    const width = Math.min(
      660,
      (((layout.orientation === "landscape" ? long : short) - 2 * margin) * 96) / 25.4,
    );
    header.push(
      new Paragraph({
        keepNext: true,
        children: [
          new ImageRun({
            type: "png",
            data: await sharp(Buffer.from(renderStudentIdentitySvg())).png().toBuffer(),
            altText: {
              title: "考号填写与填涂区",
              description: "姓名、班级与六位考号填写及填涂区",
              name: "考号",
            },
            transformation: { width, height: (width * 170) / 574 },
          }),
        ],
      }),
    );
  }
  header.push(
    paragraph(paper.name, {
      alignment: AlignmentType.CENTER,
      spacing: { after: 210 },
      run: { bold: true, size: 36 },
    }),
  );
  if (paper.kind === "EXAM")
    header.push(
      paragraph(`${paper.subject} · ${paper.grade}`, { alignment: AlignmentType.CENTER }),
    );
  header.push(paragraph(paper.instructions));
  const children: (Paragraph | Table)[] = [];
  const imageCache = new Map<string, Promise<Buffer>>();
  const maxWidth =
    ((((layout.orientation === "landscape" ? long : short) -
      margin * 2 -
      (layout.columns - 1) * DOCUMENT_COLUMN_GAP_MM) /
      layout.columns) *
      96) /
    25.4;
  const optionRows = (options: { label: string; text: string }[], indent = 0, keepNext = false) => {
    if (!options.length) return [];
    // Estimate visible glyph widths rather than counting LaTeX command characters.
    // Word wraps inside each cell; longer options keep the full column width.
    const longest = Math.max(
      ...options.map((option) => {
        const visible = renderPrintRichText(`${option.label}. ${option.text}`)
          .replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, "")
          .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
          .replace(/<[^>]*>/g, "")
          .replace(/&(?:\w+|#\d+|#x[\da-f]+);/gi, "M");
        return Array.from(visible).reduce(
          (width, char) => width + (/[^\x00-\xff]/.test(char) ? 1 : 0.6),
          0,
        );
      }),
    );
    const width = Math.floor(maxWidth * 15) - indent;
    const availableEm = width / ((layout.fontSizePt ?? DOCUMENT_DEFAULTS.fontSizePt) * 20);
    const columns =
      [4, 2, 1].find((count) => count <= options.length && (longest + 1) * count <= availableEm) ??
      1;
    if (columns === 1)
      return options.map((option, index) =>
        paragraph(`${option.label}. ${option.text}`, {
          indent: { left: indent },
          keepNext: keepNext || index < options.length - 1,
        }),
      );
    const cellWidth = Math.floor(width / columns);
    const border = { style: BorderStyle.NONE, size: 0, color: "auto" };
    return [
      new Table({
        width: { size: width, type: WidthType.DXA },
        indent: { size: indent, type: WidthType.DXA },
        columnWidths: Array.from({ length: columns }, () => cellWidth),
        layout: TableLayoutType.FIXED,
        borders: {
          top: border,
          bottom: border,
          left: border,
          right: border,
          insideHorizontal: border,
          insideVertical: border,
        },
        rows: Array.from(
          { length: Math.ceil(options.length / columns) },
          (_, row) =>
            new TableRow({
              cantSplit: true,
              children: Array.from({ length: columns }, (_, column) => {
                const option = options[row * columns + column];
                return new TableCell({
                  width: { size: cellWidth, type: WidthType.DXA },
                  margins: { top: 0, bottom: 0, left: 0, right: 100 },
                  children: [
                    paragraph(option ? `${option.label}. ${option.text}` : "", {
                      keepNext: keepNext || row < Math.ceil(options.length / columns) - 1,
                    }),
                  ],
                });
              }),
            }),
        ),
      }),
    ];
  };
  type Block = {
    key: string;
    item?: Paper["items"][number];
    index?: number;
    text?: string;
    pageBreakBefore?: boolean;
  };
  const blocks = orderedDocumentBlocks<Block>(
    paper.items.map((item, index) => ({ key: item.questionId, item, index })),
    layout,
    (block) => ({ key: block.id, text: block.text, pageBreakBefore: block.pageBreakBefore }),
  );
  for (const block of blocks) {
    if (!block.item) {
      children.push(paragraph(block.text ?? "", { pageBreakBefore: block.pageBreakBefore }));
      continue;
    }
    const item = block.item;
    const content = item.snapshot.content;
    const settings = layout.questionLayouts?.[item.questionId];
    const answerSpaceMm =
      paper.kind === "HOMEWORK" ? documentAnswerSpaceMm(layout, item.snapshot) : 0;
    children.push(
      paragraph(`${block.index! + 1}. ${content.stem}`, {
        pageBreakBefore: settings?.pageBreakBefore,
        keepNext: true,
        spacing: {
          before: 60,
          after: 0,
          line: Math.round((layout.lineHeight ?? DOCUMENT_DEFAULTS.lineHeight) * 240),
          lineRule: LineRuleType.AUTO,
        },
      }),
    );
    for (const url of content.images) {
      if (!imageCache.has(url))
        imageCache.set(
          url,
          loadAsset(url).then((asset) => sharp(asset.buffer).png().toBuffer()),
        );
      const data = await imageCache.get(url)!;
      const meta = await sharp(data).metadata();
      const scale = Math.min(1, maxWidth / meta.width!, 220 / meta.height!);
      children.push(
        new Paragraph({
          keepNext: answerSpaceMm > 0,
          children: [
            new ImageRun({
              type: "png",
              data,
              transformation: {
                width: Math.max(1, Math.round(meta.width! * scale)),
                height: Math.max(1, Math.round(meta.height! * scale)),
              },
            }),
          ],
        }),
      );
    }
    children.push(...optionRows(content.options, 0, answerSpaceMm > 0));
    for (const [index, part] of content.parts.entries()) {
      children.push(
        paragraph(`（${index + 1}）${part.stem}`, {
          indent: { left: 270 },
          keepNext: answerSpaceMm > 0,
        }),
      );
      children.push(...optionRows(part.options, 270, answerSpaceMm > 0));
    }
    if (paper.kind === "HOMEWORK") {
      if (answerSpaceMm > 0)
        children.push(
          new Paragraph({
            text: "",
            spacing: {
              before: 0,
              line: twips(answerSpaceMm),
              lineRule: LineRuleType.EXACT,
              after: 0,
            },
          }),
        );
      children.push(
        new Paragraph({
          text: "",
          spacing: {
            line: 1,
            lineRule: LineRuleType.EXACT,
            after: twips(settings?.spaceAfterMm ?? 2),
          },
        }),
      );
    }
  }
  const page = {
    size: {
      width: twips(short),
      height: twips(long),
      orientation:
        layout.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
    },
    margin: {
      top: twips(margin),
      left: twips(margin),
      right: twips(margin),
      bottom: twips(margin + DOCUMENT_FOOTER_MM),
    },
  };
  return Packer.toBuffer(
    new Document({
      title: paper.name,
      creator: "OhMyPaper",
      styles: {
        default: {
          document: {
            run: {
              font: {
                ascii: layout.fontFamily ?? DOCUMENT_DEFAULTS.fontFamily,
                eastAsia: layout.fontFamily ?? DOCUMENT_DEFAULTS.fontFamily,
                hAnsi: layout.fontFamily ?? DOCUMENT_DEFAULTS.fontFamily,
              },
              size: (layout.fontSizePt ?? DOCUMENT_DEFAULTS.fontSizePt) * 2,
            },
          },
        },
      },
      sections: [
        { properties: { page }, children: header },
        {
          properties: {
            page,
            type: SectionType.CONTINUOUS,
            column: {
              count: layout.columns,
              space: twips(DOCUMENT_COLUMN_GAP_MM),
              equalWidth: true,
              separate: layout.columns > 1,
            },
          },
          children: children.length ? children : [paragraph("")],
        },
      ],
    }),
  );
}
