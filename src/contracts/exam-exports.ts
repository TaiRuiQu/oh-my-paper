import { z } from "zod";
export const exportFormatSchema = z.enum(["pdf", "docx"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export const EXPORT_FORMATS = {
  pdf: { label: "PDF", mime: "application/pdf" },
  docx: {
    label: "Word",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
} as const;
export function examExportFilename(name: string, format: ExportFormat) {
  const safe = Array.from(
    name
      .toWellFormed()
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, " ")
      .trim(),
  )
    .slice(0, 100)
    .join("")
    .replace(/[. ]+$/, "");
  return `${safe || "试卷"}.${format}`;
}
