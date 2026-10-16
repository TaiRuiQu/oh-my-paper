import type { ScanSubmission } from "@/contracts/platform";

type ScanEvidence = Pick<ScanSubmission, "alignment" | "sourceFiles">;

function recognitionRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Manual uploads key page evidence by page number; AI imports key it by source URL.
export function scanPageRecognition(submission: ScanEvidence, index: number) {
  const { alignment, sourceFiles } = submission;
  return recognitionRecord(
    alignment?.[sourceFiles[index]] ?? alignment?.[String(index + 1)] ?? alignment,
  );
}

export function submissionNeedsScanReview(submission: ScanEvidence): boolean {
  return (
    submission.alignment?.needsReview === true ||
    (submission.sourceFiles ?? []).some(
      (_, index) => scanPageRecognition(submission, index)?.needsReview === true,
    )
  );
}
