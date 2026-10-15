import type { ReactNode } from "react";

export function DocumentOptions({ children }: { children: ReactNode[] }) {
  return (
    <div className="p-document-options">
      {children.length === 4
        ? [0, 2].map((start) => (
            <div className="p-document-option-pair" key={start}>
              {children.slice(start, start + 2)}
            </div>
          ))
        : children}
    </div>
  );
}
