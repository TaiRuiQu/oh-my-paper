import "server-only";
import katex from "katex";
import { mml2omml } from "mathml2omml";
import {
  convertToXmlComponent,
  ImportedXmlComponent,
  Math as DocxMath,
  type IContext,
  type IXmlableObject,
} from "docx";
import { xml2js, js2xml, type Element as XmlElement } from "xml-js";
import { RequestError } from "@/server/http/errors";
import type { ExportFormula } from "./document";

// Only KaTeX-generated MathML enters the converter; never accept uploaded XML.
const supportedTags = new Set([
  "math",
  "semantics",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "ms",
  "mspace",
  "mstyle",
  "mfrac",
  "msqrt",
  "mroot",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "menclose",
  "mmultiscripts",
  "mprescripts",
  "none",
]);

class NativeWordMath extends DocxMath {
  constructor(private readonly imported: ImportedXmlComponent) {
    super({ children: [] });
  }
  override prepForXml(context: IContext): IXmlableObject {
    const result = this.imported.prepForXml(context);
    if (!result) throw new Error("Invalid Office Math root");
    return result;
  }
}

const element = (
  name: string,
  elements: XmlElement[] = [],
  attributes?: XmlElement["attributes"],
): XmlElement => ({ type: "element", name, elements, attributes });
const serialize = (node: XmlElement) => js2xml({ elements: [node] }, { compact: false });
const parse = (xml: string) => (xml2js(xml, { compact: false }) as XmlElement).elements![0];
const contents = (node: XmlElement) =>
  (node.elements ?? []).map((child) => String(child.text ?? "")).join("");

function convertMathml(mathml: XmlElement, latex: string) {
  let prefix = "WORD_MATH_FENCE_";
  while (latex.includes(prefix)) prefix += "_";
  let sequence = 0;
  function convert(root: XmlElement): XmlElement {
    const replacements = new Map<string, XmlElement>();
    function prepare(node: XmlElement): XmlElement {
      if (node.name && !supportedTags.has(node.name))
        throw new Error(`Unsupported MathML element: ${node.name}`);
      const children = (node.elements ?? []).filter((child) => child.name !== "annotation");
      // KaTeX expresses stretchy delimiters as fenced mrows; preserve them as native m:d.
      if (node.name === "mrow" && children.length) {
        const first = children[0],
          last = children[children.length - 1];
        const opening = first.name === "mo" && first.attributes?.fence === "true";
        const closing = last !== first && last.name === "mo" && last.attributes?.fence === "true";
        if (opening || closing) {
          const body = children.slice(opening ? 1 : 0, closing ? -1 : undefined);
          const inner = convert(element("math", [element("mrow", body)]));
          const id = `${prefix}${sequence++}__`;
          replacements.set(
            id,
            element("m:d", [
              element("m:dPr", [
                element("m:begChr", [], { "m:val": opening ? contents(first) : "" }),
                element("m:endChr", [], { "m:val": closing ? contents(last) : "" }),
                element("m:grow", [], { "m:val": "1" }),
              ]),
              element("m:e", inner.elements),
            ]),
          );
          return element("mtext", [{ type: "text", text: id }]);
        }
      }
      return {
        ...node,
        attributes:
          node.name === "mfrac" && /^0(?:px|pt|em)?$/.test(String(node.attributes?.linethickness))
            ? { ...node.attributes, linethickness: "0" }
            : node.attributes,
        elements: children.map(prepare),
      };
    }
    const prepared = prepare(root);
    // Keep XML entities encoded; the converter otherwise emits raw comparison signs.
    const omml = parse(mml2omml(serialize(prepared), { disableDecode: true }));
    function normalize(node: XmlElement): XmlElement[] {
      if (node.name === "m:r") {
        const text = node.elements?.find((child) => child.name === "m:t");
        const value = text && contents(text);
        if (value && value.includes(prefix)) {
          const result: XmlElement[] = [];
          let start = 0;
          const run = (part: string) =>
            element("m:r", [
              ...(node.elements ?? []).filter((child) => child !== text),
              element("m:t", [{ type: "text", text: part }], { "xml:space": "preserve" }),
            ]);
          for (const match of value.matchAll(new RegExp(`${prefix}\\d+__`, "g"))) {
            if (match.index! > start) result.push(run(value.slice(start, match.index)));
            const replacement = replacements.get(match[0]);
            if (!replacement) throw new Error("Unresolved math delimiter");
            result.push(replacement);
            start = match.index! + match[0].length;
          }
          if (start < value.length) result.push(run(value.slice(start)));
          return result;
        }
      }
      const children = (node.elements ?? []).flatMap(normalize);
      // Nested mstyle nodes can produce duplicate argument properties; Word permits one.
      const lastProperties = children.findLastIndex((child) => child.name === "m:argPr");
      return [
        {
          ...node,
          elements: children.filter(
            (child, index) => child.name !== "m:argPr" || index === lastProperties,
          ),
        },
      ];
    }
    const result = normalize(omml)[0];
    if (serialize(result).includes(prefix)) throw new Error("Unresolved math delimiter");
    return result;
  }
  return convert(mathml);
}

export function wordMathXml(formula: ExportFormula) {
  try {
    if (formula.latex.length > 10_000) throw new Error("Formula is too long");
    const markup = katex.renderToString(formula.latex, {
      output: "mathml",
      displayMode: formula.display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      maxSize: 100,
      maxExpand: 1000,
    });
    const mathml = markup.slice(markup.indexOf("<math"), markup.lastIndexOf("</math>") + 7);
    if (!mathml.startsWith("<math")) throw new Error("MathML was not generated");
    const equation = convertMathml(parse(mathml), formula.latex);
    const xml = serialize(equation);
    if (equation.name !== "m:oMath" || !xml.includes("<m:t"))
      throw new Error("An empty Office Math equation was generated");
    return formula.display
      ? serialize(
          element(
            "m:oMathPara",
            [element("m:oMathParaPr", [element("m:jc", [], { "m:val": "center" })]), equation],
            { "xmlns:m": "http://schemas.openxmlformats.org/officeDocument/2006/math" },
          ),
        )
      : xml;
  } catch (cause) {
    throw new RequestError(
      422,
      `数学公式无法转换为 Word 原生公式，请检查 LaTeX 语法：${formula.latex.slice(0, 120)}`,
      { cause },
    );
  }
}

export function wordMath(xml: string): DocxMath {
  const component = convertToXmlComponent(parse(xml));
  if (!(component instanceof ImportedXmlComponent))
    throw new Error("Invalid Office Math component");
  return new NativeWordMath(component);
}
