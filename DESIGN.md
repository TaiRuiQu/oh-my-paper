---
name: Oh My Paper v2
description: 清晰、安静的 K12 教学工作台，从题库和组卷到阅卷与学习反馈。
colors:
  workspace: "#f5f7fb"
  white: "#ffffff"
  ink: "#202b3d"
  muted: "#58657a"
  line: "#dfe5ee"
  accent: "#2459d3"
  accent-hover: "#1946b4"
  accent-soft: "#edf2ff"
  control-line: "#bbc7d8"
  secondary-hover: "#f1f5fc"
  quiet-surface: "#f7f9fd"
  placeholder: "#69768a"
  focus: "#9db9fa"
  selection: "#dce7ff"
  table-header: "#f9fafc"
  status-text: "#2451bc"
  success: "#21724e"
  success-fill: "#edf8f1"
  warning: "#7b5414"
  warning-fill: "#fff6e4"
  danger: "#b42318"
  danger-fill: "#fff3f1"
  tag-fill: "#f0f3f8"
  tag-text: "#52627c"
  drawer-scrim: "rgb(20 30 50 / 0.3)"
typography:
  headline:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  headline-mobile:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "23px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.65
  question-title:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.65
  body:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.65
  button:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.65
  caption:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
  badge:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.65
  score:
    fontFamily: '"Geist Variable", "Noto Sans SC Variable", sans-serif'
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.65
rounded:
  badge: "4px"
  compact: "6px"
  control: "7px"
  notice: "8px"
  surface: "12px"
spacing:
  xs: "4px"
  label-gap: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  form-gap: "17px"
  section: "22px"
  xl: "24px"
  workspace: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
    typography: "{typography.button}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
    typography: "{typography.button}"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-danger:
    backgroundColor: "#fff5f3"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
    typography: "{typography.button}"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "6px"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
    typography: "{typography.label}"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  status:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.status-text}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
    typography: "{typography.badge}"
  status-success:
    backgroundColor: "{colors.success-fill}"
    textColor: "{colors.success}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  status-warning:
    backgroundColor: "{colors.warning-fill}"
    textColor: "{colors.warning}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  tag:
    backgroundColor: "{colors.tag-fill}"
    textColor: "{colors.tag-text}"
    rounded: "{rounded.badge}"
    padding: "2px 7px"
    typography: "{typography.badge}"
  surface:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.surface}"
  notice:
    backgroundColor: "{colors.accent-soft}"
    textColor: "#254d98"
    rounded: "{rounded.notice}"
    padding: "12px 16px"
---

# Design System: Oh My Paper v2

## Overview

**Creative North Star: "Operate · 安静的教学工作台"**

Oh My Paper 面向备课、组织考试和逐题评阅的教师，以及查看学习反馈的学生。浅灰工作区、白色纸面和克制的蓝色操作建立稳定的信息层级；紧凑表格、中文无衬线文字和原生表单让教学内容成为界面中心。

视觉表达来自可核对的题目、作答、分值和状态。工作台用连续的内联面板组织操作，细线划分信息，复杂资料与执行记录使用原生折叠。桌面保留导航，手机转为抽屉和单列内容。

**Key Characteristics:**

- 浅灰工作区、白色面板与蓝色主要操作。
- 自托管中文字体、紧凑标题和对齐的表格数值。
- 内联编辑、明确动作名称与可恢复的状态反馈。
- 桌面持续导航、手机焦点受控抽屉和局部表格滚动。

此文档提取自当前 `src/app/globals.css`、`src/app/layout.tsx` 与 `src/components/platform/`。前置 tokens 是规范，正文解释用途；各模块的实际入口、任务与验收证据记录在 surface brief 和 `v2-docs/`。

## Colors

冷灰中性色托住白纸面，单一蓝色承担行动与选择，语义绿、琥珀和红承担结果状态。

### Primary

- **教学蓝**（`accent`、`accent-hover`）：主要按钮、链接、选中导航、知识点得分条和框选标记；悬停使用更深蓝。
- **安静蓝**（`accent-soft`、`status-text`）：选中导航、状态标签和选中内容切换。`focus` 形成可见焦点环，`selection` 标记选中文字。

### Neutral

- **冷灰工作区**（`workspace`）围绕**白纸面**（`white`），区分页面与可操作内容。
- **墨色正文**（`ink`）与**灰蓝说明**（`muted`）区分主内容和元信息。`placeholder` 专用于字段占位文字。
- **结构细线**（`line`）分隔面板、导航和表格；`control-line` 是字段与次要按钮边界。
- `secondary-hover`、`quiet-surface`、`table-header` 分别服务次要操作悬停、导航悬停／执行记录底色和表头。
- `tag-fill` 与 `tag-text` 用于知识点标签；`drawer-scrim` 在手机导航打开时压低主内容。

**The Semantic State Rule.** 状态颜色必须与明确的中文状态或错误说明一起出现；保留排队、处理中、完成和失败的实际区别。

成功使用 `success`／`success-fill`。需处理或执行失败的状态标签使用 `warning`／`warning-fill`；表单和请求错误使用 `danger`／`danger-fill`。错误通知有单独边框，不能只靠颜色解释问题。

## Typography

**Body and Heading Font:** 自托管 Geist Variable 与 Noto Sans SC Variable，末位回退为 sans-serif。`src/app/layout.tsx` 通过 Fontsource 引入两种变量字体。英文和数字采用 Geist，中文采用 Noto Sans SC；KaTeX 使用自身数学字体。

紧凑、可扫描的中文层级贯穿标题、表格和表单。正文与页面标题的精确值见前置 tokens；说明文字和账户名称常用较小字号（13px），表头用更紧凑的半粗文字（12px、600），状态标签和知识点标签最小（11px）。品牌和评分数值用较强的字重（650）；概要汇总值稍大（20px）。页面说明限制宽度（72ch），便于快速阅读。

**The Numeric Evidence Rule.** 表格与分数使用等宽数字排布（tabular numerals），保持得分、满分和排名的阅读顺序；未评分处显示「待评分」或破折号。

## Layout

桌面外壳为双列网格：持续可见的导航栏（228px）和可收缩的内容列。导航贴住视口顶部，高度为完整视口；顶部账户栏高（72px），左右留白（36px）。主内容居中，最大宽度（1540px），默认留白为上（30px）、左右（36px）、下（72px）。面板之间留空（22px）；页标题与说明形成一组，标题区下方留空（26px）。

面板标题使用上下留白（20px）和左右留白（22px），正文与表单使用内边距（22px）。表单两列等宽，列间距（16px）；字段标签与输入间距（6px），表单字段组间距（17px）。操作组允许换行并留间距（8px）。阅卷和部分编辑界面使用内容／操作双列（1fr 与 minmax(300px, 0.78fr)），列间距（22px）。

较窄桌面（1100px 及以下）把主区留白减为（24px），双列工作区变成单列，坐标编辑由六列变为三列。手机（760px 及以下）移除外壳侧栏列，导航改为固定抽屉（250px）；顶栏高（64px），左右留白（16px）。主内容留白为（24px 16px 60px），标题与刷新按钮上下排列，表单改单列，面板主要内边距缩为（17px）。账户名称超长时省略，角色标签隐藏。

**The Local Overflow Rule.** 管理表格保留内容所需宽度（最小 680px），在所属区域滚动，页面列本身必须可收缩。表格容器以对应内容命名的 region 保持键盘可聚焦与滚动；沿用全局可见焦点。数学公式、Markdown 表格与代码块也在各自容器内横向滚动；手机工具栏换行，题目操作与分值保持邻近。

作答和题图限制在容器宽度内，最大高度（550px），以 contain 保留内容；原图框选区最大宽度（700px）。答题卡预览沿用 A4 比例（210∶297），最大宽度（450px）。

## Elevation & Depth

日常工作面板和控件以白色填充与单像素边界建立深度，没有装饰阴影。手机导航抽屉是唯一提升的界面层：遮罩位于第 9 层，抽屉位于第 10 层，使用向右的柔和阴影（10px 0 35px rgb(20 30 50 / 0.12)）。

**The Visible Focus Rule.** 键盘焦点使用清晰的浅蓝外轮廓（3px，偏移 3px），覆盖链接、按钮和原生字段；跳转到主要内容的链接在聚焦时显示。

主内容仅在允许动效时进入一次：轻微上移与不透明度变化，持续（0.2s），缓动（cubic-bezier(0.2, 0.8, 0.2, 1)）。减少动态效果偏好下不播放此动画。AI 状态来自真实后台任务，不能由动效推断进度。

## Shapes

工作面板和登录面板采用柔和大圆角（`surface`）。字段、主要按钮和导航采用更紧凑的圆角（`control`）；图标按钮与内容切换采用（`compact`），通知采用（`notice`），状态与知识点标签采用（`badge`）。几何用于功能：答题卡定位点为实心方形，作答框保留准确的直角边界。

所有普通面板以单像素边界区分白纸面；表格使用横向分隔线，内容切换使用独立边框与选中底色。图标来自 Lucide 的一致线条系统，导航图标尺寸（18px），品牌图标（22px），菜单与关闭图标（20px）。

## Components

### Buttons

主要按钮紧凑明确，居中排列文字和可选图标，最小高（40px），图标间距（7px）。教学蓝承担当前主要动作；次要操作使用白色和字段边界，悬停变为浅冷灰；危险操作使用浅红底、红字和红色边界。表格行内按钮更短（32px），留白（4px 10px）。图标按钮以透明底和灰蓝图标开始，悬停变为安静蓝底和教学蓝图标。

禁用按钮透明度降低（0.6），光标为 wait。保存按钮明确显示「正在保存…」。文本按钮保持蓝色下划线，与普通正文区别。所有按钮沿用全局可见焦点。

### Inputs / Fields

使用原生 input、select、textarea，白底、单像素 `control-line` 边界、最小高（40px），留白（8px 11px）。标签在字段上方，提示在下方；多行文字区域最小高（100px）并可垂直调整。复选／单选控件保持原生语义，大小（17px），选中色为教学蓝。上传使用可见原生文件选择器，旁边保留已选图片数量或文件列表。

### Navigation

白色导航栏以紧凑连续条目组织教学流程；悬停为浅冷灰与蓝字，当前入口以安静蓝底、蓝字和半粗字重表示，并设置 `aria-current="page"`。分组说明采用小号灰蓝文字。手机打开抽屉后聚焦关闭按钮，Tab 在抽屉内循环，主内容 inert；Escape、遮罩和关闭按钮收起导航，并把焦点交还菜单按钮。关闭状态的抽屉不参与焦点顺序。

### Status badges and tags

紧凑矩形标签承载中文状态。AI 明确显示「等待执行」「正在处理」「已完成」「执行失败」；扫描和阅卷使用各自的业务状态。成功标签为绿底绿字，需要处理的标签为琥珀底深字。知识点用中性灰蓝标签，允许换行。

### Panels, tables and notices

白色面板把标题、说明、操作和内容相连，标题与内容以细线分隔。表格采用浅灰表头、左对齐单元格和等宽数字；单元格留白（12px 14px）。空态保留普通中文说明与适用的下一步操作，不以装饰插图替代。通知使用 status 或 alert 语义，成功、失败都给出可读文字。

### Content switches and disclosures

学情内容切换由带边框的原生按钮组成，间距（7px），选中按钮以蓝字、安静蓝底和 `aria-pressed` 标明。题目答案、评分标准、卡号识别设置与执行记录使用原生 details／summary 折叠；保留键盘和浏览器默认展开行为。执行记录位于最大高（260px）的局部滚动区域。

### Teaching materials and review

题干通过 Markdown 与 KaTeX 呈现，选项保持标号，配图展示完整内容，混合题保留子问类型和分值。Markdown 内的站内材料图像与结构化题图均保留容器宽度约束。评阅将学生作答与评分表单邻近摆放；逐小问输入得分和反馈，自动汇总总分，评阅历史折叠保存。原图框选用蓝色边界和轻蓝底区分题区；键盘添加区域后展开页码与比例坐标字段，允许精确调整和移除。

扫描仪设备选择之后显示纸张来源与分辨率；eSCL 自动进纸模式增加单/双面和页数上限，使用同一两列原生字段布局，手机改单列。采集中的字段、文件替换与移除禁用；不可用设备禁选，错误保留现有列表，多页按序加入并保留图像格式。

## Do's and Don'ts

### Do:

- **Do** 使用浅灰工作区、白纸面与蓝色主要操作，并保持紧凑表格和一致字段。
- **Do** 保留中文动作名称、题目编号、配图、选项、子问分值和实际作答的层级。
- **Do** 用清楚的状态文字、错误说明和重试动作承载后台工作的反馈。
- **Do** 保留可见焦点、抽屉焦点管理、内联编辑与减少动态效果行为。
- **Do** 让筛选范围同时决定成绩、知识点、科目汇总和错题数量。

### Don't:

- **Don't** 用装饰性指标卡、插图或渐变取代教学内容与真实表格。
- **Don't** 把等待动画当成任务百分比或准确率证据。
- **Don't** 隐藏未评分、扫描不确定信息或失败任务的恢复路径。
- **Don't** 让长表格扩张整个页面，或让手机用户只能使用指针创建答题区域。
- **Don't** 把教师管理入口和他人的作答加入学生的「我的学习」视图。
