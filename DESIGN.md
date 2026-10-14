---
name: Oh My Paper
description: Modern, concise OA workspace for paper management and student grading.
colors:
  print-ink: "#111111"
  print-line: "#555555"
  print-quote: "#888888"
  white: "#ffffff"
  workspace: "#f5f7fb"
  ink: "#202b3d"
  muted: "#657084"
  line: "#e3e8f0"
  accent: "#2459d3"
  accent-hover: "#1946b4"
  accent-soft: "#edf2ff"
  nav-active-text: "#2451bc"
  selection: "#dce7ff"
  control-line: "#c5cfdf"
  field-line: "#d4d4d8"
  icon-hover: "#f4f4f5"
  avatar-fill: "#edf1f8"
  avatar-text: "#49556b"
  upload-fill: "#fbfcff"
  upload-line: "#b9c8e4"
  table-header: "#f9fafc"
  table-hover: "#fcfdff"
  status-processing-fill: "#eef3ff"
  status-processing-text: "#2852b5"
  status-completed-fill: "#edf8f1"
  status-completed-text: "#21724e"
  status-failed-fill: "#fff0ed"
  status-failed-text: "#a33c32"
  empty-icon: "#8895a9"
  score-fill: "#f5f8fe"
  grade-incorrect: "#9a493a"
  grade-review: "#946413"
  danger: "#b42318"
  drawer-scrim: "rgb(20 30 50 / 0.28)"
typography:
  pdf-body:
    fontFamily: '"NSimSun", "Noto Serif CJK SC", "Noto Sans CJK SC", serif'
    fontSize: "5.5pt"
    fontWeight: 400
    lineHeight: 1.45
  headline:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  headline-mobile:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.65
  brand:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.65
  processing-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.65
  panel-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.65
  empty-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.65
  question-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.65
  body:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.65
  caption:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
  score:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif'
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.65
  debug:
    fontFamily: "ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  status: "5px"
  compact: "6px"
  control: "8px"
  upload: "10px"
  surface: "12px"
  circle: "50%"
spacing:
  xs: "4px"
  icon-gap: "7px"
  sm: "8px"
  nav-gap: "12px"
  md: "16px"
  lg: "20px"
  section: "24px"
  upload: "28px"
  xl: "32px"
  workspace: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "7px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 16px"
    typography: "{typography.label}"
  button-icon:
    rounded: "{rounded.compact}"
    size: "36px"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact}"
    padding: "7px 12px"
  search-field:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.nav-active-text}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  status-processing:
    backgroundColor: "{colors.status-processing-fill}"
    textColor: "{colors.status-processing-text}"
    rounded: "{rounded.status}"
    padding: "4px 9px"
    typography: "{typography.caption}"
  status-completed:
    backgroundColor: "{colors.status-completed-fill}"
    textColor: "{colors.status-completed-text}"
    rounded: "{rounded.status}"
    padding: "4px 9px"
  status-failed:
    backgroundColor: "{colors.status-failed-fill}"
    textColor: "{colors.status-failed-text}"
    rounded: "{rounded.status}"
    padding: "4px 9px"
  surface:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.surface}"
  upload-target:
    backgroundColor: "{colors.upload-fill}"
    rounded: "{rounded.upload}"
    padding: "28px 20px"
  detail-surface:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.surface}"
    padding: "28px 32px"
  grade-summary:
    backgroundColor: "{colors.score-fill}"
    rounded: "{rounded.control}"
    padding: "20px 24px"
  debug-disclosure:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "16px 20px"
---

# Design System: Oh My Paper

## Overview

**Creative North Star: "Operate · 教学管理工作台"**

Oh My Paper uses the modern, concise OA/admin direction chosen by the user: a white navigation rail and header around a cool gray work area, with white bordered working surfaces and blue primary actions. Chinese system sans, compact tables and consistent fields make paper and grading tasks easy to scan.

The interface has three clearly named work areas: 试卷管理, 作业批改 and 答题卡批改. Content and actionable results carry the hierarchy. Ordinary users see completed work, calm waiting feedback and recovery actions; administrator execution evidence sits behind collapsed disclosures.

**Key Characteristics:**

- Cool gray workspace, white navigation and content surfaces, restrained blue actions.
- Desktop office layout with a persistent rail; phone navigation uses an accessible drawer.
- Compact management tables and predictable form controls.
- Readable question hierarchy and reports, with calm waiting and separate administrator evidence.

This document records the implemented replacement world. The final management section in `src/app/globals.css` overrides the earlier parsing-interface styles; those earlier colors and layout rules are not the new shell's authority. Product facts remain in `PRODUCT.md`.

## Colors

Cool blue-gray neutrals support a single blue action accent; green, red and amber communicate meaningful result states. Frontmatter values are the normative palette.

### Primary

- **Action Blue** (`accent`): primary buttons, text actions, focus outlines, upload icons and score emphasis. `accent-hover` darkens primary buttons.
- **Quiet Blue** (`accent-soft`, `nav-active-text`): active navigation and dragged-over upload targets. `selection` marks selected text.

### Neutral

- **Cool Workspace** (`workspace`) surrounds white panels; `white` is the sidebar, header, field and content surface.
- **Slate Ink** (`ink`) and **Muted Slate** (`muted`) distinguish primary content from descriptions and metadata.
- `line` separates structures. `control-line` is the exam selector and secondary-button hover border; `field-line` remains on general form fields. `icon-hover` is the compact icon-button hover fill.
- `avatar-fill` and `avatar-text` identify the account. `empty-icon` softens empty-state illustrations made from stroke icons.
- `upload-fill` and `upload-line` define the dashed file target. `table-header` and `table-hover` are subtle local table fills. `score-fill` frames the grading summary.
- `drawer-scrim` dims the main area while the mobile navigation is open.

### Status

- Processing uses `status-processing-fill` / `status-processing-text`; completed uses `status-completed-fill` / `status-completed-text`; retryable failure uses `status-failed-fill` / `status-failed-text`.
- Grading outcomes use `grade-incorrect`, `status-completed-text` and `grade-review`. Form and technical error text uses `danger`.
- Status badges pair color with a Chinese label and a small dot; color alone does not carry the state.

## Typography

**PDF export font:** "NSimSun" is the CSS alias for the user-provided `assets/fonts/nsimsun.ttf` file, embedded locally in the print document. The font is the verified NSimSun face extracted from simsun.ttc (version 5.03). PDF body text uses 11 pt; KaTeX retains its own math fonts.

**Body and heading font:** "Geist Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif. English and numerals use Geist; Chinese uses Noto Sans SC. Both variable fonts are bundled via Fontsource and served from the application origin, with Unicode subsets loaded as needed and `font-display: swap`. System fonts are fallbacks only; Windows no longer depends on Microsoft YaHei.

The hierarchy is compact and Chinese-first. Body copy uses 14px / 1.65. The implementation uses measured role sizes rather than a fixed mathematical scale:

- **Page headline:** 25px, weight 650, line-height 1.4, letter-spacing -0.02em; 22px at 760px and below.
- **Section title:** 18px / 600. **Panel title:** 16px / 600.
- **Brand and waiting title:** 17px / 600. **Empty-state title:** 15px / 600.
- **Question title:** 14px / 600. **Body:** 14px / 400.
- **Control label:** 13px / 500; descriptions, dates and table cells also use 13px with context-specific regular weight.
- **Caption:** 12px; table headings use weight 500 and column labels use weight 500. Status and account-role labels are compact captions.
- **Score:** 28px / 600 with tabular numerals. Administrator tool names and serialized details use `ui-monospace, monospace` at 12px.

Question prose is bounded to 75ch. Waiting descriptions are bounded to 50ch and empty-state paragraphs to 65ch. Preserve meaningful headings and printed question numbering.

## Layout

Desktop uses a fixed 228px white sidebar and a main body offset by the same width. The white account header has a 72px minimum height and 16px 36px padding. Main content has 34px 36px 64px padding, a 1600px maximum width and centered margins within the available body. The rail has 28px 16px padding; navigation starts 42px below the brand, with 6px gaps and 46px minimum-height links.

At 1050px and below, the rail and body offset become 200px. Main padding becomes 28px 24px 48px; header and table padding tighten. At 760px and below, the 228px rail becomes a drawer, the body offset disappears, the header minimum height becomes 64px, and main padding becomes 24px 16px 40px. Closed navigation is hidden from focus. Opening moves focus to its close button, traps Tab within the rail, makes the body inert, and restores the toggle focus on close; Escape and the scrim close it.

Use 16–32px gaps to group task controls and content. Page headings place title and primary action on one row; section headings can wrap on mobile. Tables live inside a horizontally scrollable surface and retain a 680px minimum width on mobile, so the page itself can stay within the viewport. Mobile search expands to the toolbar width.

Reports use `minmax(0, 1.25fr) minmax(0, 1fr)` columns with a 32px gap. The criteria column has a 24px inset and left separator. At 760px and below these become one column with a 20px gap and a top separator. Summary and question headings wrap. Question images stay contained, with a 600px maximum figure width and 500px maximum image height. Wide mathematics and Markdown tables scroll locally. Supporting form and administrator-feed rows also adapt at 640px.

## Elevation & Depth

The implemented management UI is flat: no box shadows are defined for its controls or surfaces. White fills, the cool workspace and single-pixel separators create structural depth. The mobile drawer uses the translucent `drawer-scrim` and stacking order (scrim 25, rail 30), without a shadow treatment.

Focus uses a 2px Action Blue outline with a 4px offset. Search uses a 2px offset and upload uses a 3px offset. Do not replace visible focus with a subtle border color alone.

## Shapes

Use 12px corners on working surfaces and the authentication panel; 10px on upload targets; 8px on primary/secondary buttons, active navigation, search, exam selection, score summaries and debug disclosures. Compact icon buttons and general fields retain 6px corners; status badges use 5px corners. Avatars and the 5px status/loading dots use circular geometry. Working surfaces have a 1px `line` border; file targets use a dashed `upload-line` border. Content tabs use a 2px bottom indicator rather than pill geometry.

## Components

### Buttons

Primary buttons use Action Blue, white text, a matching border, 8px radius, at least 40px height and 7px 16px padding. Their 13px labels have weight 500, with 7px icon gaps. Hover darkens the fill and border. Secondary actions use white, Slate Ink and a `line` border; hover uses `workspace` and `control-line`. Compact icon buttons have 36px minimum width/height and 6px radius. Text actions use blue 13px labels and underline on hover. Disabled buttons and fields use a not-allowed cursor and 0.6 opacity.

### Inputs / Fields

General fields and selects use white, a 1px `field-line` border, 6px radius, 38px minimum height and 7px 12px padding. The exam selector uses 8px corners and `control-line`, with a 680px maximum form width. Labels sit above fields with 6px separation. Search is an 8px bordered wrapper around a borderless 13px input; its wrapper owns the visible focus state. Placeholders use Muted Slate and the caret uses Action Blue. Inline error messages retain readable text and recovery actions.

### Navigation

The sidebar exposes 试卷管理 (`/dashboard`), 作业批改 (`/grading`) and 答题卡批改 (`/grading/cards`) with 19px Lucide stroke icons. Links use 10px 14px padding, 12px gaps and 8px corners. Default text is muted, hover is Slate Ink on the workspace fill, and active is blue on Quiet Blue with weight 600. The existing `/quick-grading` pages and report links remain under 作业批改, without a separate navigation entry. Administrators additionally receive 试卷记录审查, 用户管理, AI 设置 and 用量统计 below a separator. The white header identifies the current work area and account; mobile hides the role caption and retains avatar, name and sign-out.

### Status badges

Use compact 12px labels with 4px 9px padding, 5px corners and a 5px currentColor dot. Labels are 处理中, 已完成 and 需重试. The same processing treatment covers queued and running work for ordinary users.

### Surfaces, uploads and tables

White bordered surfaces use 12px corners. Upload sections have 26px 28px padding; detail sections use 28px 32px. Both use 20px on mobile. The file target is at least 160px tall, with 28px 20px padding, a blue stroke icon and a full-area native file input. Keyboard focus outlines the target; dragging changes its fill and border to blue; disabled targets use 0.55 opacity. Upload limits and the selected-file list remain visible.

List toolbars use 20px 24px padding and a bottom separator. Table headings use 12px medium labels and 12px 24px padding; cells use 13px labels and 18px 24px padding. Names wrap within their title area and actions stay together. A subtle row hover supports scanning. Empty states use a muted stroke icon, a 15px title and useful Chinese copy.

### Questions, standard answers and reports

The content switch between 试题内容 and 标准答案 is a transparent button row with a blue bottom border for the active view. Keep big-question sections, numbered questions and indented subquestions distinct through headings, spacing and dividers. Standard answers and grading criteria use the report columns described above. Grading summaries use a soft blue fill with 28px tabular score emphasis; outcome labels accompany the per-question content. Unknown scores remain unknown and unreadable answers carry a review label.

### Waiting and recovery

`ProcessingState` is a polite live status area with a 290px minimum height, 38px 24px padding and 24px spacing. A 40px document icon gently rises 5px over 2.4s; three 5px dots rise 4px over 1.5s with 0.18s offsets. This communicates ongoing work without exposing backend stages. The message explains that results appear automatically and that the user can return later. Failure notices offer concrete retry/reload actions and ordinary-language errors.

Color transitions on buttons/navigation use 160ms; the mobile drawer uses a 180ms ease translation. `prefers-reduced-motion: reduce` disables all animations and transitions, including loading and administrator spinner motion.

### Administrator debug

Execution evidence uses native `details` disclosures, closed by default. The outer debug panel uses 8px corners, a white fill, 1px border and 16px 20px padding (14px mobile); summaries use 13px Muted Slate. Nested rounds and tools show timing, messages, inputs, outputs and authenticated image evidence. Scroll areas bound long logs. This technical presentation belongs only in administrator views; it must not become ordinary task progress or a draft preview.

No generated or sourced shipping raster imagery was added for this visual world. Lucide SVG stroke icons and CSS loading motion are the interface assets; uploaded paper materials and administrator evidence are user content.

等待区保留文档与圆点动画，并在标题后显示累计时间。题目进度使用 6px 蓝色轨道、平滑的填充宽度过渡，以及左右对齐的操作名称和「已完成 / 总题数」。总数未知时使用不显示百分比的往返动画；已知总数后仅依据已保存题目更新。从作业识别试题的报告依次显示解析、答案和批改三项进度。普通用户可以查看计数，草稿与工具轨迹仍在管理员调试区。所有动画遵守减少动态效果偏好。

AI 设置在提供商列表之前显示「功能模型」。AI 解析、AI 批改、AI 生成答案分别占一行，模型按提供商分组，推理选项随模型变化，每项单独保存并显示配置状态。桌面采用功能名称、模型、推理程度、保存按钮四列，窄屏改为单列；内容区使用现有白色边框表面与 24px 内边距，手机内边距 20px。所有日期与时间使用北京时间，服务器和浏览器渲染保持一致。

### 作业批改与答题卡批改

作业批改的上传表面先用原生单选按钮选择试题来源，默认「从作业中识别试题」，另一项为「使用已录入的试卷」。选择已有试卷后才显示试卷选择、答案状态与查看链接。主上传区明确每个 PDF 一位学生，图片按列表顺序合为一位学生并与 PDF 分开提交；文件列表下显示学生数与独立报告数，提交按钮带本次作业份数。上传区下方是统一的作业批改记录表，保留原有两类报告链接。

答题卡批改的主要表面先选择已标记模板，显示对应试卷与标准答案链接、版式与页数要求，再上传学生答题卡。每个 PDF 自动独立分组；选择图片时显示「每位学生的图片文件数」，列表下逐组列出学生与文件，PDF 不受该设置影响。下方「新建答题卡模板」使用原生 `details`，默认收起；没有模板时主表面提示首次建立模板。模板区域预览同样默认收起，按页显示蓝色作答范围，模板进度与失败重试保留。批次报告按学生展示完整逐题反馈、分值与复核状态，失败恢复只重试未完成题目。

这些表面沿用现有上传、字段、模型选择、按钮、状态、进度、额度与表格样式。文件限制与分组说明紧邻上传区；选中内容和学生分组是可读状态。较长说明可换行，手机仍使用单列控件与局部表格滚动。

### 数学内容

Markdown 展示公式接受 `$$` 与表达式同行或跨多行的写法，页面与导出共享解析规则。保留公式之间的文字段落；长式只在所属公式容器内横向滚动，沿用现有 KaTeX 字体与展示间距。

## Do's and Don'ts

### Do:

- **Do** use the cool gray workspace, white bordered surfaces and blue primary actions.
- **Do** keep the three main Chinese navigation labels and one clear starting action per work area.
- **Do** preserve question numbering, shared stems, subquestions, material images, mathematical content and unknown scores.
- **Do** keep results, retries and quiet waiting feedback readable for ordinary users; keep execution evidence in collapsed administrator disclosures.
- **Do** preserve keyboard focus, drawer focus management, local table/math scrolling and reduced-motion behavior.

### Don't:

- **Don't** expose internal stages, saved drafts or technical exceptions to ordinary users.
- **Don't** replace working paper content and tables with decorative metric cards.
- **Don't** add a display font, decorative illustration or ornamental gradient to this office interface.
- **Don't** claim progress percentages or stage completion through the waiting animation.
- **Don't** reintroduce class, batch-student, practice or analytics navigation into the documented three-module scope.

上传区域与列表使用相同的内容区宽度，不设置额外的 900px 上限。添加试卷和作业批改的识别模式分别在主文件上传区下方提供「标准答案（可选）」，添加试卷时提示先解析试卷再匹配答案；作业批改明确上传时共同采用该答案、未上传时自动生成，作业与答案合计的文件数和大小限制保持可见。试卷标准答案页并列提供「上传标准答案」和「生成标准答案」，上传面板内使用现有文件列表、移除按钮、进度与提交操作；上传解析进度称为「已解析答案」。

试卷上传和作业批改识别模式中的「标准答案（可选）」使用原生 `details` 折叠区，默认收起，选中文件时在摘要中保留数量。任务模型选择按功能并列显示模型与推理强度，选项随模型变化；本次任务与倍率说明集中在管理员 AI 设置中。系统管理新增「试卷记录审查」和「用户管理」，沿用搜索、表格、分页与现有表单样式。审查详情提供试题与标准答案切换；用户编辑和密码重置以内联面板呈现，明确目标用户、错误与成功反馈，手机表格保持局部滚动。

试卷详情与管理员审查详情在标题操作区提供「导出 PDF」和「导出 Word」两个次级按钮，沿用现有图标、间距和按钮样式。导出期间两个按钮均禁用，当前格式显示「正在导出」，失败提示与按钮同组，用户可重试。手机上操作区自然换行。打印文档参照 `examples/数学_仅试题.pdf`，采用 210 × 148 mm 横向纸张、5 mm 页边距、四栏、5.5 pt 宋体正文与 1.45 倍行高。PDF 首页面标题横跨左侧两栏，页脚显示页码；大题说明加粗，阿拉伯题号和题干同行，选择题选项横排，公式、表格与配图随正文排版。小问题号与正文首段同行，题号加粗，后续段落保留结构；Word 使用原生四栏、可编辑段落与表格，数学公式使用可编辑的 Word 原生 Office Math（OMML）对象；独立公式使用居中的原生公式段落，题目配图仍为图片。

试卷列表和详情提供「删除」操作，点击后在原位置显示确认与取消操作，确认成功立即移出用户列表。原始文件、解析结果及执行记录保留，管理员审查列表与详情标注「用户已删除」。详情中的「编辑试卷」打开内联编辑表单，支持名称、题干、选项、小问、说明与分值，保留题号顺序和配图；文本支持现有 Markdown 与公式语法，提供预览、保存反馈及放弃修改确认。保存操作检查版本和运行任务，新版试题需要重新生成或上传标准答案，旧答案和批改结果仍保留在审查记录中。表单沿用现有字段与按钮样式，底部保存操作保持可见，手机布局自然换行。

所有页面左下角显示 `package.json` 中的版本号，使用 12px 次要文字。桌面导航底部预留空间，移动端与登录页面同样显示，便于定位当前部署版本。

侧边栏对应工作区右侧显示进行中的任务数，仅在排队或运行中的任务数大于零时出现。使用 28px 蓝色转圈外环、12px 静止数字与等宽数字排版，每 3 秒刷新当前用户的任务数；同一操作的内部步骤合并计数，作业批改合并 `GRADING` 与 `QUICK` 流程，答题卡模板与批次计入独立的答题卡批改工作区。桌面与手机抽屉共用显示，减少动态效果时外圈静止，读屏可读出任务数。

提供商请求设置的最大输出 tokens 默认值与允许上限为 384K（393,216），新任务使用提供商配置快照。
