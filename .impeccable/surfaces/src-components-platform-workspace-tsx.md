---
version: 1
slug: "src-components-platform-workspace-tsx"
primary_target: "src/components/platform/workspace.tsx"
related_targets:
  - "src/components/platform/primitives.tsx"
  - "src/components/platform/questions.tsx"
  - "src/components/platform/papers.tsx"
  - "src/components/platform/templates.tsx"
  - "src/components/platform/classes.tsx"
  - "src/components/platform/assessments.tsx"
  - "src/components/platform/scans.tsx"
  - "src/components/platform/workbook-crop.tsx"
  - "src/components/platform/reviews.tsx"
  - "src/components/platform/analytics.tsx"
  - "src/components/platform/ai.tsx"
  - "src/components/platform/admin.tsx"
---

# v2 教学工作台

Mode: Operate。教师准备题目、组织考试、录入作答、完成阅卷并查看学情；学生查看自己的已发布成绩与学习反馈。完整教学流程依据 `v2-docs/migration-prd.md`；视觉采用浅灰、白纸面与蓝色工作台。

## Direction contract

THESIS: 通过明确的教学模块，把可复用题库、考试组织和逐题反馈连接起来；每一步都有真实数据、可检查结果和恢复动作。

OWN-WORLD: 自托管 Geist 与 Noto Sans SC；浅灰工作区、白色导航和内联面板、蓝色主要操作、紧凑表格及一致原生字段。精确的分值、排名与题区几何构成工作台的视觉特征。

STORY: 建立题库 → 选题组卷 → 制作答题卡 → 建立班级与参试名单 → 安排考试／作业 → 扫描或练习册框选录入 → 人工或 AI 逐题阅卷 → 发布成绩 → 查看排名、错题和知识点反馈。AI 在对应模块提供辅助任务，并把结果写回同一业务对象。

FIRST VIEWPORT: 桌面双列外壳含 228px 持续导航、72px 账户栏和标题／说明／刷新数据操作；相应 AI 入口在模块业务面板之前。手机导航改为 250px 焦点受控抽屉，顶栏 64px，内容单列，标题和操作上下排列。学生唯一入口是「我的学习」。

FORM: 已授权的 code-led Operate 实现，无 approved comp。真实题目、表格、表单与扫描图像承载内容；状态标签与可展开记录表达后台任务，不使用装饰进度动画。

FINISH: 当前视觉、行为与设计记录必须相符；review 结论及验收局限保留在 `v2-docs/ui-review.md` 和验收文档中。

## Navigation and roles

教师导航依序为「教学概览」「题库」「试卷与作业」「答题卡模板」「班级与学生」「考试与作业安排」「扫描与作答录入」「阅卷工作台」「成绩与学情」。管理员额外显示「系统管理」，维护账号角色和模型提供商。学生只显示「我的学习」，不暴露管理入口。

各入口统一使用 `/workspace?tab=`，key 依次为 `overview`、`questions`、`papers`、`templates`、`classes`、`assessments`、`scans`、`reviews`、`analytics`、`admin`。手机关闭导航时没有隐藏可聚焦条目；打开后聚焦关闭按钮、约束 Tab、令主内容 inert，Escape／遮罩／关闭按钮恢复菜单焦点。

## Shipped interaction contract

- 题库明确区分单选、多选、填空、主观与混合题；内联保存题干、选项、逐空／逐问答案、解析、评分标准、知识点及配图。题干支持 Markdown 与数学公式，答案和评分资料在原生折叠中核对。
- 组卷从题库选题，调整题序、分值与栏目，保存题目快照，区分考试与作业。已布置试卷修改受限，界面提供另存操作。
- 答题卡从九科预设及当前试卷生成，支持多页、题区坐标、配图、四角定位点、卡号填涂区及页码识别。界面显示可编辑坐标与卡片预览，提供恢复自动排布与另存。
- 扫描入口选择考试、试卷和答题卡／练习册模式，批量选择 PNG／JPEG 图片。答题卡识别卡号并切题，异常项提示查看原图、选择身份后重新上传。练习册支持指定学生、原图拖拽和键盘「添加第 N 题答题区域」；添加后展开精确页码与 0–1 比例坐标字段，可调整、移除并提交。
- 扫描仪连接保留桥接地址与令牌，发现设备后选择纸张来源及分辨率；eSCL 自动进纸显示单／双面和页数上限，可按序采集多个 PNG／JPEG 图像。不可用设备禁选，错误不清空已有文件，采集中禁用文件替换与移除。
- 阅卷先选择考试和学生答卷，逐题查看实际作答；题目、答案、评分标准与历史记录可折叠。支持第一评、第二评及分差超阈值的仲裁三评。混合题逐问得分／反馈自动汇总到总分，保存后更新本轮记录。
- 考试安排包含科目、班级、保存的参试名单、单／双评设置与排名赋分。全部参试学生所有科目完成才可发布；发布后撤回才能修改评分。成绩表明确显示原始分、赋分、联合排名与班级排名，未评分处保留「待评分」。
- 学情有「成绩排名」「知识点掌握」「错题与练习」三项内容切换。考试、班级和学生通过同一 scoped analytics 请求影响成绩、知识点分母、科目汇总和错题数量；切换班级清除已选学生。学生仅获得本人已发布结果；错题保留原题快照、作答、得分与反馈。
- AI 六任务为 `IMPORT`、`ENRICH`、`ASSEMBLE`、`TEMPLATE`、`GRADE`、`RECOMMEND`。题库提供图片识别导入及折叠的已有试题补全；组卷、模板、阅卷和学情分别提供对应入口。选择模型后提交持久化后台任务，离开页面仍继续执行。页面三秒轮询，显示排队／运行／完成／失败，失败可重试，完成后刷新业务数据。有权限查看该任务的用户可展开执行记录。
- 管理表格最小宽度 680px，在容器内滚动；长数学公式、Markdown 表格和代码块同样局部滚动。双列操作区在 1100px 以下堆叠，手机表单单列、工具栏换行。保存中、无可用模型、错误保留、成功和空态均有实际文字反馈。

## Evidence and limits

规范来源为当前 `globals.css`、`layout.tsx` 和上述 platform 组件。设计 tokens、八节说明和面板预览同步记录在 `DESIGN.md` 与 `.impeccable/design.json`。

2026-10-14 已直接查看 `.impeccable/review/desktop.png`、`mobile.png`、`student.png`、`mixed-review.png`。截图分别展示桌面 AI 阅卷完成、390px 手机状态、学生学习反馈与推荐、混合题逐问 0/2 + 3/3 = 3/5；学生与混合题是滚动后的视口，截图包含开发工具入口。

真实浏览器操作、后台持久化与 AI 六任务证据见 `v2-docs/acceptance-browser.md`，更广领域覆盖见非 AI、AI 验收报告。截图与报告不能替代实体扫描仪、打印机或实体触屏验收。本次 review 指出的学情范围、键盘首次创建区域与设计记录均已修复；最终 review 结论为所列范围可交付（ship），具体核查范围与验收局限见主验收文档。
