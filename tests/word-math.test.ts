// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Document, Paragraph, Packer, TextRun } from "docx";
import JSZip from "jszip";
import { wordMath, wordMathXml } from "@/server/exams/export/math";

const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";
describe("editable native Word equations", () => {
  it.each([
    [String.raw`\frac{x_1+1}{\sqrt{x}}`, ["f", "sSub", "rad"]],
    [String.raw`x_i^2+\sqrt[3]{y}`, ["sSubSup", "rad", "deg"]],
    [String.raw`\sum_{i=1}^{n} i+\int_0^1 x^2\,dx`, ["nary", "sub", "sup"]],
    [String.raw`\lim_{x\to0}\frac{\sin x}{x}=1`, ["limLow", "f"]],
    [String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, ["m", "mr"]],
    [String.raw`f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}`, ["m", "mr"]],
    [String.raw`\vec{AB}+\overline{CD}+\hat{x}`, ["acc"]],
    [String.raw`\left(\frac{a}{b}\right)+\binom{n}{k}`, ["d", "f"]],
    [String.raw`\mathbb{R}\ni\alpha\le\beta\quad\text{当 }x>0`, ["r", "t"]],
  ])("preserves mathematical structure for %s", (latex, structures) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const xml = wordMathXml({ id: "formula", latex, display: true });
      const parsed = new DOMParser().parseFromString(xml, "text/xml");
      expect(parsed.querySelector("parsererror")).toBeNull();
      for (const structure of structures)
        expect(parsed.getElementsByTagNameNS(mathNamespace, structure).length).toBeGreaterThan(0);
      expect(parsed.documentElement.localName).toBe("oMathPara");
      if (latex.includes("\\binom"))
        expect(
          [...parsed.getElementsByTagNameNS(mathNamespace, "type")].some(
            (node) => node.getAttributeNS(mathNamespace, "val") === "noBar",
          ),
        ).toBe(true);
      for (const node of parsed.getElementsByTagNameNS(mathNamespace, "argPr"))
        expect(
          [...node.parentElement!.children].filter((child) => child.localName === "argPr"),
        ).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it("embeds math beside ordinary text without XML wrappers or image relationships", async () => {
    const xml = wordMathXml({ id: "formula", latex: String.raw`\frac{1}{2}+x^2`, display: false });
    const file = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun("计算 "),
                wordMath(xml),
                new TextRun(" 的值。"),
                wordMath(xml),
              ],
            }),
          ],
        },
      ],
    });
    const zip = await JSZip.loadAsync(await Packer.toBuffer(file));
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const parsed = new DOMParser().parseFromString(documentXml, "text/xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.getElementsByTagNameNS(mathNamespace, "oMath")).toHaveLength(2);
    expect(documentXml).toContain("计算 ");
    expect(documentXml).toContain(" 的值。");
    expect(documentXml).not.toContain("undefined");
    expect(documentXml).not.toContain("<w:drawing");
    expect(Object.keys(zip.files).some((name) => name.startsWith("word/media/"))).toBe(false);
  });
  it("rejects malformed and oversized formulas instead of generating incomplete equations", () => {
    for (const latex of [String.raw`\frac{1}{`, String.raw`\unknowncommand{x}`, "x".repeat(10_001)])
      expect(() => wordMathXml({ id: "formula", latex, display: false })).toThrow(
        /无法转换为 Word 原生公式/,
      );
  });
});
