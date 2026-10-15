export function WorkbookAnswerSpace({ heightMm, label }: { heightMm: number; label?: string }) {
  if (heightMm === 0) return null;
  return (
    <div
      className="p-workbook-answer-space"
      style={{ height: `${heightMm}mm` }}
      aria-label={label}
    />
  );
}
