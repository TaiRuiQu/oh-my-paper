# Evaluation dataset

The six user-provided real documents in `examples/` are development samples. `exam-samples.ts` records minimal structural expectations from visual inspection; `pnpm eval:exams` calls DeepSeek for parsing and independent image verification, then saves structural checks and unresolved findings under ignored `storage/exam-evals/`. These checks are not a held-out benchmark or a transcription accuracy score. Do not add fabricated questions, scores, or benchmark results here.

When ready, add de-identified samples and annotations with stable sample IDs, source/template groups, file type, subject, and grade. Split development and held-out samples by template/source before prompt tuning, as described in the implementation plan. Keep raw student files outside Git.
