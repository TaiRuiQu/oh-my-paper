---
name: Oh My Paper
description: White, full-width teaching workspace for paper review and grading.
colors:
  surface: "#ffffff"
  paper: "#fafafa"
  ink: "#18181b"
  neutral-strong: "#27272a"
  neutral-deep: "#09090b"
  neutral-fill: "#f4f4f5"
  muted: "#62626b"
  line: "#e4e4e7"
  input: "#d4d4d8"
  ring: "#71717a"
  figure: "#52525b"
  question-selection: "#2563eb"
  error: "#a22f2a"
  destructive: "#b42318"
  review-text: "#614516"
typography:
  headline:
    fontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.65
  body:
    fontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.65
  caption:
    fontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  md: "6px"
  lg: "8px"
  panel: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  comparison: "20px"
  lg: "24px"
  section: "28px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  field:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
    height: "38px"
  status-secondary:
    backgroundColor: "{colors.neutral-fill}"
    textColor: "{colors.neutral-strong}"
    rounded: "{rounded.md}"
    padding: "2px 10px"
  navigation-active:
    backgroundColor: "{colors.neutral-fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  upload-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
  tabs-list:
    backgroundColor: "{colors.neutral-fill}"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "4px"
    height: "42px"
---

# Design System: Oh My Paper

## Overview

**Creative North Star: "Operate · 教学工作台"**

Operate is a white, full-width teaching workspace. Chinese labels, compact controls, neutral separators, and clear task states let teachers move between classes, reusable papers, grading, and learning analysis. The interface uses the established shadcn/ui new-york neutral primitives and the existing Chinese sans-serif stack.

The content carries the hierarchy: page title, task controls, then the working material. Original papers, question crops, and electronic questions remain visible together when space permits. Color identifies an actionable selection or an error; it is not a decorative backdrop.

**Key Characteristics:**

- Pure white application surfaces with zinc text and borders.
- Full-width work areas with a persistent desktop sidebar and mobile Sheet.
- Compact shadcn/ui controls, restrained corners, and clear keyboard focus.
- Original paper, crop, and electronic question form a coordinated review workspace.

This system was extracted from `src/app/globals.css`, `src/components/workspace-shell.tsx`, the local UI primitives, and the paper/class/grading components. The frontmatter owns tokens; `.impeccable/design.json` extends it with preview snippets, responsive thresholds, motion, and depth metadata.

## Colors

White supplies the work surface and zinc supplies information hierarchy. Frontmatter color values are normative.

### Primary

- **Ink:** body copy, headings, active navigation, and shadcn primary actions.
- **Neutral Strong / Neutral Deep:** the existing custom action background and its darker hover state.
- **Question Selection:** the current question's bounding box and small label on the original paper. The selected area has a very light translucent fill.
- **Error / Destructive:** existing field errors and the shadcn destructive action variant.

### Neutral

- **Surface:** shell, topbar, sidebar, paper panels, and main canvas.
- **Paper / Neutral Fill:** table headings, upload targets, hover surfaces, active navigation, tabs, and secondary badges.
- **Muted:** supporting copy, captions, placeholders, and inactive navigation.
- **Line / Input:** dividers and surface boundaries / stronger form strokes.
- **Ring / Figure:** keyboard focus and unselected question outlines / dashed figure outlines and their labels.
- **Review Text:** cautionary review notes on a pale neutral surface.

**The White Workspace Rule.** The application shell and main work surface remain pure white; neutral fills mark local state and supporting surfaces.

**The Selection Has Meaning Rule.** Blue marks the current question on the original paper. Figure bounds remain dashed and grayscale.

## Typography

**Body and heading font:** the existing Noto Sans CJK SC, PingFang SC, Microsoft YaHei, sans-serif stack. There is no separate display face.

The type system is compact and practical. Weight, whitespace, and document structure distinguish tasks. Paragraph text is limited to a readable measure (70ch); grading scores use tabular numerals.

### Hierarchy

- **Headline:** workspace page title; mobile reduces it to (22px).
- **Title:** paper comparison headings and question headings. Generic secondary headings elsewhere retain their existing size (1.15rem).
- **Body:** ordinary Chinese text, task descriptions, and electronic question content.
- **Label:** fields, topbar text, custom action labels, and table content. Stock shadcn controls use text-sm type (14px / 20px).
- **Caption:** navigation descriptions, upload hints, and compact status text. Bounding-box labels are smaller (10px) because they annotate the paper image.

## Layout

The desktop shell uses a sidebar (232px), a collapsed state (68px), and a topbar (64px). Main content consumes the remaining width without a maximum container width. Desktop content and topbar gutters are (32px).

At viewport widths of (760px) or less, navigation uses the local shadcn Sheet backed by Radix Dialog. The left drawer is (280px) wide with a maximum width (85vw); it retains labels and icons, a close control, screen-reader title/description, and modal focus handling. The main area uses horizontal gutters (16px), top spacing (24px), and bottom spacing (40px). The topbar retains its height and hides secondary breadcrumb/account text.

Paper review uses three coordinated columns above (1150px): original paper, question crop, electronic question in a (1 / 0.8 / 1.2) ratio with gaps (20px). At (1150px) or less, original and crop share two columns while electronic content spans the next row. At (760px) or less, all three stack in that order. The original is sticky on desktop and static on mobile. Question navigation and tables scroll locally when required.

Primary navigation stays consistent across `/classes`, `/dashboard`, `/grading`, and `/analysis`. Related result and practice routes activate their parent section. Grading uses personal and batch tabs within this shell. Form pairs stack at the existing threshold (540px); supporting older layouts also retain rules at (600px) and (800px).

Controls cluster with gaps (8–16px), comparison content uses (20px), and major sections separate by (24–32px). Form widths can remain bounded for readable editing while the workspace remains full-width.

## Elevation & Depth

Work areas are flat: white surfaces, whitespace, and light neutral dividers provide structural depth. Shadcn buttons, fields, and active tab triggers retain their small stock shadows. The mobile Sheet retains its larger stock shadow and dark overlay. Focus rings identify interaction rather than elevation. Exact shadow definitions are in the sidecar.

**The Flat Work Areas Rule.** Use whitespace and neutral separators for structural depth. Keep shadows on stock controls and the mobile navigation Sheet.

## Shapes

Controls and navigation use the gently curved `md` token. Tabs and upload panels use `lg`; existing empty/editor panels can use `panel`. Paper and crop images and electronic question columns remain rectangular. The account avatar is circular; status badges are compact rounded rectangles. Borders are thin (1px), except the current question's functional outline (2px).

## Components

### Buttons

Use the local official shadcn/ui new-york variants. Default is dark neutral with white text; outline is white with an input-colored stroke; ghost stays transparent until hover. Common heights are (36px), with small (32px), large (40px), and square icon variants (36px). Stock primary hover reduces opacity to (90%); outline and ghost use neutral accent fill. Shadcn focus uses the ring token; disabled controls block pointer interaction and fade to (50%).

Existing custom buttons follow the same compact neutral direction: minimum height (36px), label type, darker primary hover, and white outlined secondary treatment. Their loading-disabled state keeps the wait cursor and opacity (65%).

### Inputs / Fields

White or transparent fields have neutral strokes and compact corners. Within labeled forms, inputs are at least (38px) tall, using the frontmatter field padding; standalone shadcn inputs are (36px). Textareas preserve readable multiline spacing, the stock minimum height (60px), and vertical resizing within labeled forms. Hints sit immediately below fields. Preserve error borders, placeholder contrast, caret color, keyboard focus, and disabled feedback.

### Navigation

Desktop links combine a Lucide stroke icon, Chinese label, and secondary description. Active links use neutral fill and stronger text; hover uses the pale paper surface. Collapsed navigation retains icons and link titles. Mobile opens the same labeled navigation through Sheet; choosing a route closes it. Preserve the Sheet's keyboard focus containment, Escape dismissal, and focus return.

### Tabs and status badges

Personal and batch grading modes use the shadcn Tabs primitive. The grading rail is (42px) high, with neutral fill and a white active trigger. Secondary badges describe saved-solution state in a compact neutral style; review-needed status stays textual and distinct from question selection.

### Tables and containers

Use the local Table primitive for rosters and grading data. Working tables have compact labels, horizontal cell padding (16px), neutral row rules, and pale headers. Keep overflow local to the table. Upload and empty-state containers use white surfaces and neutral borders; the dashed upload target has a pale surface and a visible drag state. Comparison columns use separators rather than nested cards.

### Paper comparison and saved solutions

The original-paper canvas aligns question bounds with the paper image. The current question uses blue selection; other question bounds are neutral and figure bounds are dashed grayscale. Question-index buttons, source bounds, crops, and electronic content refer to the same selection.

A saved solution sits below its electronic question, separated by a neutral rule. Show standard answer, explanation, criteria, and status in this context. Completed saved AI solutions are immediately usable for grading; teacher edits update the reusable answer. Advanced parsing/download details use the existing disclosure controls.

## Do's and Don'ts

### Do:

- Do keep the workspace background pure white and use neutral borders to separate work areas.
- Do use the existing shadcn/ui new-york neutral primitives and Lucide stroke icons.
- Do preserve the original / crop / electronic question order as the grid collapses.
- Do keep saved standard answers, their readiness status, and grading actions close to the question content.
- Do show clear Chinese labels, recovery messages, empty states, and disabled or loading feedback.

### Don't:

- Don't introduce a decorative accent palette, gradients, illustrations, or a new display font.
- Don't constrain the OA work area inside a centered narrow page container.
- Don't use the blue question-selection treatment as a general brand accent.
- Don't replace paper content or working tables with decorative metric cards.
- Don't imply that teacher approval is required before a completed saved AI solution can be used for grading.
