import type { PaperItem, AssessmentPaper } from "@/contracts/platform";

/** Owned JSON collections are validated by domain commands before persistence. */
export function paperRecord<T extends { items: unknown }>(row: T) {
  const { items, ...rest } = row;
  return { ...rest, items: items as PaperItem[] };
}

export function assessmentRecord<T extends { papers: unknown }>(row: T) {
  const { papers, ...rest } = row;
  return { ...rest, papers: papers as AssessmentPaper[] };
}
