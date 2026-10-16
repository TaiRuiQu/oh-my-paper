-- Include answer-card requests in the existing credit ledger.
ALTER TABLE "credit_usage" DROP CONSTRAINT "credit_usage_taskKind_check";
ALTER TABLE "credit_usage" ADD CONSTRAINT "credit_usage_taskKind_check"
  CHECK ("taskKind" IN ('EXAM', 'ANSWER', 'GRADING', 'CARD_TEMPLATE', 'CARD_BATCH'));
