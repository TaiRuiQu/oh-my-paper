export function WorkbookAnswerLines({ lines, label }: { lines: number; label?: string }) {
  if (lines === 0) return null;
  return (
    <div className="p-workbook-lines" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} />
      ))}
    </div>
  );
}
