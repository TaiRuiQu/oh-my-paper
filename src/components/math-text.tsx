import type { ReactNode } from "react";

export function MathText({ text, images }: { text: string; images: Record<string, string> }) {
  const pieces: ReactNode[] = []; let cursor = 0;
  for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
    const latex = match[1] ?? match[2]; pieces.push(text.slice(cursor, match.index));
    // Render generated SVG in an isolated image context, never raw HTML.
    // eslint-disable-next-line @next/next/no-img-element
    pieces.push(typeof images[latex] === "string" ? <img className="math-image" src={images[latex]} alt={latex} key={match.index} /> : <code className="math-fallback" key={match.index}>{latex}</code>);
    cursor = match.index + match[0].length;
  }
  pieces.push(text.slice(cursor)); return <>{pieces}</>;
}
