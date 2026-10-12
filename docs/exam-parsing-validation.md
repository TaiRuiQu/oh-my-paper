# Real-sample exam parsing validation

Validated on 2026-10-11 using the six user-provided files and live DeepSeek API calls with model `deepseek-flash`. Every source page underwent extraction and a separate image-based verification request. Figure regions additionally underwent coordinate-grid review; the biology photo used local Tesseract OSD (270° rotation). Clean simple geometry was anchored to original connected strokes and visually spot-checked.

| Sample | Pages | Questions | Figure crops (including annotation evidence) | Structural checks | Review status |
| --- | --- | --- | --- | --- | --- |
| math | 2 | 19 | 2 | 5/5 | needs_review |
| chemistry | 4 | 20 | 21 | 6/6 | needs_review |
| physics | 11 | 15 | 26 | 8/8 | needs_review |
| biology | 1 | 4 | 7 | 7/7 | needs_review |
| teacher | 10 | 15 | 14 | 6/6 | needs_review |
| chinese | 4 | 0 | 0 | 7/7 | needs_review |

Total: 73 questions across 32 pages, 70 source figure crops, 39/39 structural checks passed. These are development examples, not held-out benchmarks. Question counts and figure coverage do not establish text/formula accuracy. All files retain review findings for obscured content, uncertain image regions or other unresolved model observations. Polluted and unresolved images are withheld from clean exports.

Private generated artifacts: `storage/exam-evals/complete-validation/<sample>/` contains `exam.json`, `exam.md`, `verification.json`, originals, page images and figure evidence. The combined report is `storage/exam-evals/complete-validation/report.json`; these paths are ignored by Git. No credentials or raw student answers are committed in this report.

Reproduce with `pnpm eval:exams`; recheck saved artifacts without model calls with `pnpm eval:exams --reuse --out storage/exam-evals/complete-validation`. Network model results may vary; inspect the recorded review findings rather than treating structural success as an accuracy guarantee.

Validation: 19 automated tests passed, along with type checking, lint and the Next.js production build.
