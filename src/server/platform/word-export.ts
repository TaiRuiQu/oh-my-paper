import "server-only";
import sharp from "sharp";
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
  TextRun,
  type IContext,
  type IParagraphOptions,
  type IXmlableObject,
  type ParagraphChild,
} from "docx";
import type { Paper } from "@/contracts/platform";
import { orderedDocumentBlocks } from "@/lib/document-layout";
import type { ExportAssetLoader } from "./pdf-export";

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
  const margin = layout.marginMm ?? 18;
  const paragraph = (text: string, options: IParagraphOptions = {}) =>
    new Paragraph({
      children: richRuns(text),
      spacing: {
        after: 60,
        line: Math.round((layout.lineHeight ?? 1.8) * 240),
        lineRule: LineRuleType.AUTO,
      },
      ...options,
    });
  const header = [
    paragraph(paper.name, {
      alignment: AlignmentType.CENTER,
      spacing: { after: 210 },
      run: { bold: true, size: 36 },
    }),
  ];
  if (paper.kind === "EXAM")
    header.push(
      paragraph(
        `${paper.subject} · ${paper.grade} · 共 ${paper.items.reduce((n, i) => n + i.score, 0)} 分`,
        { alignment: AlignmentType.CENTER },
      ),
    );
  header.push(paragraph(paper.instructions));
  const children: Paragraph[] = [];
  const imageCache = new Map<string, Promise<Buffer>>();
  const maxWidth =
    ((((layout.orientation === "landscape" ? long : short) -
      margin * 2 -
      (layout.columns - 1) * 6.35) /
      layout.columns) *
      96) /
    25.4;
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
    children.push(
      paragraph(
        `${block.index! + 1}. ${item.section}${layout.showScores === false ? "" : `    ${item.score} 分`}`,
        { pageBreakBefore: settings?.pageBreakBefore, keepNext: true, run: { bold: true } },
      ),
    );
    children.push(paragraph(content.stem));
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
    for (const option of content.options)
      children.push(paragraph(`${option.label}. ${option.text}`));
    for (const [index, part] of content.parts.entries()) {
      children.push(
        paragraph(
          `（${index + 1}）${layout.showScores === false ? "" : `（${part.score} 分）`}${part.stem}`,
          { indent: { left: 270 } },
        ),
      );
      for (const option of part.options)
        children.push(paragraph(`${option.label}. ${option.text}`, { indent: { left: 270 } }));
    }
    if (paper.kind === "HOMEWORK") {
      children.push(paragraph("作答：", { keepNext: true }));
      const lines =
        settings?.answerLines ?? (["SINGLE", "MULTIPLE"].includes(item.snapshot.type) ? 1 : 4);
      for (let line = 0; line < lines; line++)
        children.push(
          new Paragraph({
            text: "",
            spacing: { line: 420, lineRule: LineRuleType.EXACT, after: 0 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "DFE5EE" } },
          }),
        );
      children.push(
        new Paragraph({ text: "", spacing: { after: twips(settings?.spaceAfterMm ?? 4) } }),
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
      bottom: twips(margin + 32 / 3.78),
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
                ascii: layout.fontFamily ?? "NSimSun",
                eastAsia: layout.fontFamily ?? "NSimSun",
                hAnsi: layout.fontFamily ?? "NSimSun",
              },
              size: (layout.fontSizePt ?? 11) * 2,
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
            column: { count: layout.columns, space: 360, equalWidth: true },
          },
          children: children.length ? children : [paragraph("")],
        },
      ],
    }),
  );
}
