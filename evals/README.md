# Evaluation dataset

The six user-provided real documents in `examples/` are development samples. `exam-samples.ts` records minimal structural expectations from visual inspection. `pnpm run eval:exams --configured --no-answers` uses the administrator's recognition Agent to inspect and recognize documents through self-selected tools, then saves structural checks and unresolved findings under ignored `storage/exam-evals/`. Live calls incur API costs. These checks do not measure transcription, solution or grading accuracy. See [sample validation](../docs/exam-parsing-validation.md) for options and limitations.

Additional accuracy evaluation needs de-identified samples with stable IDs, source/template groups, file type, subject, grade and ground-truth content or scores. Separate development and held-out samples by template/source before prompt tuning. Keep raw student files outside Git.
