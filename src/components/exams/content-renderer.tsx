/* Authenticated source crops and math SVGs render directly in image contexts. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ReactNode } from "react";
import type { ContentBlock, FigureAsset } from "@/contracts/exams";
import { findFigureAsset } from "@/lib/figure-assets";
import { MarkdownText } from "@/components/markdown-text";

export function createExamContentRenderer({
  images,
  assets,
  fileURL,
}: {
  images: Record<string, string>;
  assets: FigureAsset[];
  fileURL: (key: string) => string;
}) {
  function math(latex: string) {
    // SVGs are displayed in the browser's isolated image context, never inserted as HTML.
    return typeof images[latex] === "string" ? (
      <img className="math-image" src={images[latex]} alt={latex} />
    ) : (
      <code className="math-fallback">{latex}</code>
    );
  }
  function textWithMath(text: string) {
    const pieces: ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
      pieces.push(
        text.slice(cursor, match.index),
        <span key={match.index}>{math(match[1] ?? match[2])}</span>,
      );
      cursor = match.index + match[0].length;
    }
    pieces.push(text.slice(cursor));
    return pieces;
  }
  function blocks(content: ContentBlock[], keyPrefix: string) {
    return content.map((block, index) => {
      const key = `${keyPrefix}-${index}`;
      if (block.type === "text")
        return <MarkdownText key={key} text={block.text} images={images} />;
      if (block.type === "math")
        return (
          <div className="math-block" key={key}>
            {math(block.latex)}
          </div>
        );
      if (block.type === "table")
        return (
          <div className="table-scroll" key={key}>
            <table>
              <caption className="sr-only">试卷表格</caption>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{textWithMath(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      const asset = findFigureAsset(assets, block);
      return (
        <figure className="exam-figure" key={key}>
          {asset?.cleanKey ? (
            <>
              <img src={fileURL(asset.cleanKey)} alt={block.caption} loading="lazy" />
            </>
          ) : (
            <p className="review-note">
              配图需核对，请查看原图
              {asset && (
                <>
                  或
                  <Link href={fileURL(asset.evidenceKey)} target="_blank">
                    查看图形证据
                  </Link>
                </>
              )}
              。
            </p>
          )}
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    });
  }
  return { blocks, textWithMath };
}

export type ExamContentRenderer = ReturnType<typeof createExamContentRenderer>;
