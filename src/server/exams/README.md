# Exam parsing

`parseExam()` is a server-only Worker/CLI service for local PDF, JPG/JPEG and PNG files. It uses
`deepseek-flash` through the OpenAI-compatible **Responses API** with inline image inputs.
No database or running Web server is needed. The caller must authorize the source paths and
output location; this service is not an upload or public download endpoint.

```bash
pnpm parse:exam "examples/数学_仅试题.pdf"
pnpm parse:exam page-1.jpg page-2.png --out storage/exam-parses/my-paper
pnpm eval:exams
```

The output directory must be new; its parent must exist for direct service calls. The CLI
creates the parent. Multiple files are treated as ordered pages of one exam; evaluate
different papers separately. Configure `DEEPSEEK_API_KEY` in `.env`. Optional
`DEEPSEEK_BASE_URL` defaults to `https://api.deepseek.com`. Poppler `pdfinfo`, `pdftoppm` and
`pdftotext` must be installed; override their paths with `PDFINFO_PATH`, `PDFTOPPM_PATH` and
`PDFTOTEXT_PATH`. The parser reads no authentication/database secrets.

API formats and limits were checked against the [DeepSeek Responses reference](https://api-docs.deepseek.com/api/create-response/)
and [vision guide](https://api-docs.deepseek.com/guides/vision/). Image inputs use the SDK's current
`file` content parts, which the Responses adapter converts to `input_image`.

```ts
import { parseExam } from "@/server/exams";

const exam = await parseExam({
  files: [authorizedFilePath],
  outputDir: newTaskDirectory,
  signal: cancellationSignal,
  onProgress: ({ page, total, phase }) => console.log(page, total, phase),
});
```

Processing stages:

1. Check actual file signatures, file size and PDF page limits, preserve original files and
   SHA-256 hashes, render PDFs and extract optional text hints. Normalize images with Sharp.
2. For photographs, use optional Tesseract OSD to detect orientation. If unavailable or
   inconclusive, ask the model to choose among four physically rotated images and flag the
   orientation for visual review. Retain the rotated page as the coordinate reference. Perspective distortion is handled
   by visual reading; this version does not reconstruct book curvature or hidden text.
3. Build a compact page inventory distinguishing questions, teacher notes, answer sheets and
   reference answers. Read the overview, overlapping detail crops, and adjacent-page context.
4. Transcribe question stems, options, math, tables, nested subparts and shared materials into
   the Zod contract. Store student answers, teacher annotations and reference solutions separately.
5. Verify the complete draft against the images in a fresh model call, record corrections and
   unresolved issues. The same model is used with an independent request, not a second provider.
6. Check figure edges against a labeled coordinate grid and detail crops; anchor clean simple
   geometry diagrams to connected source pixels to prevent clipped vertices/labels.
   Crop actual figure regions, merge explicit cross-page continuations, preserve section number
   resets, and check duplicates, missing materials/options and incomplete content.

Results:

| File/directory | Contents |
| --- | --- |
| `exam.json` | Versioned digital document, source regions, questions, materials, separate annotations, assets and review status |
| `exam.md` | Clean question content with LaTeX, tables and clean figure links; no answer/annotation objects |
| `verification.json` | Model review corrections, unresolved findings, actual successful-call token usage |
| `sources/` | Original source files |
| `pages/` | Upright page images for checking normalized `[0,1]` coordinates |
| `figures/` | Source image crops; contaminated crops are evidence only and have `cleanKey: null` |
| `checkpoints/` | Page inventory, original draft, and verified draft |
| `exam.partial.json` | Last saved intermediate result if processing is interrupted |

`verified` means model-reviewed with no recorded structural/content issues; it is not a claim
of perfect transcription accuracy. `needs_review` retains recoverable content, obscured text
and polluted images for correction. `partial` means at least one page could not be parsed.
Student marks are never erased by generated imagery. Contaminated/invalid figures are withheld
from clean Markdown and require a clean original or manual replacement. Answer-only pages
cannot become inferred question templates.

Each model call has a timeout, output-token cap, and bounded transport retries. Malformed
structured output receives at most one model repair call; original wording still undergoes
image verification. Failure messages expose error types, never full SDK requests or API keys.
Failed page parsing does not silently remove the original page or stop other pages. Checkpoints
are inspection artifacts; automatic resume is not implemented yet.

For reliable photo orientation, install Tesseract with its `osd` language data. Optional
`TESSERACT_PATH` and `TESSERACT_DATA_PATH` override the executable and data directory.
This development workspace also supports a local extracted installation under `.tools/tesseract/`.
If OSD cannot establish orientation, parsing continues with a recorded review finding.

Defaults are 40 MiB per source file, 50 pages per task, 45 million decoded image pixels,
60 seconds per Poppler process and 240 seconds per model operation. File/page/process limits
can be overridden through `limits`; the model adapter accepts a custom timeout. All model
requests remain inside that timeout, including one serialization repair. `model` can be injected
with an `ExamModel` implementation for provider substitution or offline tests.

The six real example files have minimal structural annotations in `evals/exam-samples.ts`.
`pnpm eval:exams --only math,biology --out storage/exam-evals/run-id` runs extraction, model
verification and structural checks, saving `report.json`. Use `--reuse` with the same output
directory to recheck existing `exam.json` results without spending API tokens. The report
checks question-number order, figure coverage, annotation separation and answer-only pages;
it does not measure text/formula accuracy against a full human transcription. These are
development samples, not a held-out benchmark. Generated results and raw student files belong
under ignored `storage/`, outside Git.
