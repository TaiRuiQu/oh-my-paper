---
version: 1
slug: "src-components-workspace-shell-tsx"
primary_target: "src/components/workspace-shell.tsx"
related_targets: ["src/components/exam-workbench.tsx","src/components/grading-manager.tsx","src/components/answer-card-manager.tsx","src/components/answer-card-results.tsx","src/components/workflow-result.tsx","src/components/file-upload.tsx","src/components/markdown-text.tsx"]
---

# Management workspace

Mode: Operate. Audience: teachers using a desktop office workspace, with a usable phone view. Job: add papers, prepare standard answers, batch upload student work and understand each student's grading report. Administrators additionally inspect execution evidence. The user explicitly requested a modern, restrained OA/admin interface and three distinct sidebar entries: 试卷管理, 作业批改 and 答题卡批改; these constraints pin the direction.

## Direction contract

THESIS: Three distinct work areas, each with one clear starting action. Ordinary users see outcomes and calm waiting feedback; administrator traces stay behind a disclosure.
OWN-WORLD: White fixed navigation, cool gray workspace, blue primary actions, neutral bordered surfaces, Chinese system sans, compact tables and consistent form controls. Light surfaces suit daytime teacher office work. Color is restrained and semantic.
STORY: Add a paper and switch between questions and standard answers. 作业批改 defaults to recognizing questions from marked papers, with an optional shared standard answer; teachers can instead select an existing paper. Each PDF is one student with an independent report. 答题卡批改 starts with a reusable marked template and its paper/answer link, then accepts student cards containing answers alone. Missing templates can be created in the collapsed setup below the main upload form. Autonomous Agents complete the work in the background.
FIRST VIEWPORT: A 228px sidebar, 72px account header, title and primary action above the table. Upload is inline. On a 390px phone the sidebar becomes a keyboard-accessible drawer and reports stack their columns.
FORM: User-pinned OA/admin convention, implemented directly in code; no image comp or randomized seed applies. The loading document and three gentle dots communicate ongoing work without claiming internal progress.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Quality bar

All three entries must be obvious, actual uploads and reports must work, ordinary payloads and pages must hide intermediate drafts and internal stages, administrator diagnostics must be accessible but collapsed, desktop/mobile must avoid page overflow, controls must support keyboard focus and reduced motion. Existing source data and grading reports must remain accessible. Synthetic fixtures used in review are test data, not product claims.

## Shipped interaction contract

- Navigation maps 试卷管理 to `/dashboard`, 作业批改 to `/grading`, and 答题卡批改 to `/grading/cards`. Existing `/quick-grading` pages and both report URL forms remain usable under 作业批改, with no separate sidebar entry. Its active count combines `GRADING` and `QUICK`; card templates and batches have their own count. Internal steps count once per visible operation.
- 作业批改 defaults to 「从作业中识别试题」; 「使用已录入的试卷」 reveals the paper selector and answer status. The optional shared-answer disclosure starts closed and retains its selected-file count. Missing answers are generated automatically. Each PDF creates one student's flow and report; recognized papers also have separate sources. A batch creates all flows and queue jobs in one database transaction. Image pages form one student's homework in list order, and are submitted separately from PDFs.
- Upload limits are 40 MB per file, 20 files and 100 MB per request, including attached standard answers. Up to 40 homework flows may be queued or running for a user; execution remains subject to Worker/provider limits and the user's three answer/grading Agents. These are queue and execution constraints, not progress claims.
- 答题卡批改 places template selection, the corresponding paper/standard-answer link, and batch student upload first. 「新建答题卡模板」 is a native `details` below it, closed by default; first use explains that a template is required. Region previews remain collapsed, with template progress and retry preserved. Each PDF is one student; image grouping uses the selected files-per-student value and displays every group. That image setting does not affect PDFs. Complete per-student reports and retry of unfinished questions remain available.
- Request sends and interrupted streams each allow up to three transient-error retries with exponential backoff and Retry-After. Recovery repeats the current model step, preserves prior steps and saved results, and executes no local tools from failed responses. Cancellation, authentication/request errors and credit-settlement failure stop continuation. The Agent retains autonomous tool choice.
- Markdown and export share display-math parsing for `$$` delimiters beside expressions or across multiple lines. Text between formulas keeps its paragraph structure; long expressions scroll inside the formula container.

## Shipped evidence

The ordinary Operate extension is evidenced by `src/components/workspace-shell.tsx`, `grading-manager.tsx`, `answer-card-manager.tsx`, `answer-card-results.tsx`, `file-upload.tsx`, `markdown-text.tsx`, the existing management rules in `src/app/globals.css`, and the batch/recovery implementations in `src/server/exams/homework.ts` and `src/server/ai/retry.ts`. No palette, typography or radius tokens changed; the incumbent frontmatter and `.impeccable/design.json` are preserved.

The finish reviewer returned `ship` after reviewing 1440px desktop and 390px mobile captures: `.impeccable/review/homework-desktop.png`, `homework-mobile.png`, `cards-desktop.png`, `cards-mobile.png`, `solution-desktop.png` and `solution-mobile.png`. The captures use the actual components and CSS with synthetic fixtures, including the reference solution's four display formulas; they do not exercise an external AI provider. Persistence, fidelity, ceiling, material fixes and keep were reviewed with no material fixes requested. The implementation owner reported 296 passing tests, lint, typecheck and production build; the final provider-selection correction also passed 20 relevant tests, TypeScript and the related lint/format checks.

The pre-existing DESIGN.md-newer-than-sidecar drift remains unmodified. This pass records shipped interactions and evidence without regenerating the visual system.
