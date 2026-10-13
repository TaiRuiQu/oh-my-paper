---
version: 1
slug: "src-components-workspace-shell-tsx"
primary_target: "src/components/workspace-shell.tsx"
related_targets: ["src/components/exam-workbench.tsx","src/components/grading-manager.tsx","src/components/workflow-result.tsx"]
---

# Management workspace

Mode: Operate. Audience: teachers using a desktop office workspace, with a usable phone view. Job: add papers, prepare standard answers, upload one student's work and understand the grading report. Administrators additionally inspect execution evidence. The user explicitly requested a modern, restrained OA/admin interface and three sidebar entries; these constraints pin the direction.

## Direction contract

THESIS: Three distinct work areas, each with one clear starting action. Ordinary users see outcomes and calm waiting feedback; administrator traces stay behind a disclosure.
OWN-WORLD: White fixed navigation, cool gray workspace, blue primary actions, neutral bordered surfaces, Chinese system sans, compact tables and consistent form controls. Light surfaces suit daytime teacher office work. Color is restrained and semantic.
STORY: Add a paper, switch between questions and standard answers, then select it to grade a student's upload. Quick grading takes one marked-paper upload through all three backend stages without further intervention.
FIRST VIEWPORT: A 228px sidebar, 72px account header, title and primary action above the table. Upload is inline. On a 390px phone the sidebar becomes a keyboard-accessible drawer and reports stack their columns.
FORM: User-pinned OA/admin convention, implemented directly in code; no image comp or randomized seed applies. The loading document and three gentle dots communicate ongoing work without claiming internal progress.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Quality bar

All three entries must be obvious, actual uploads and reports must work, ordinary payloads and pages must hide intermediate drafts and internal stages, administrator diagnostics must be accessible but collapsed, desktop/mobile must avoid page overflow, controls must support keyboard focus and reduced motion. Existing source data and grading reports must remain accessible. Synthetic fixtures used in review are test data, not product claims.
