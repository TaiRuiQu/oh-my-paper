# 结构扩展的设计文档核对

核对日期：2026-10-14。范围是现有教学工作台拆分为独立 App Router 页面及三个纸面工作台；保留现有视觉世界，只更新本次结构变化直接过时的文档。本文不是最终验收或 ship 结论。

## 系统摘要

1. 视觉方向仍是「Operate · 安静的教学工作台」，浅灰工作区、白面板、教学蓝、Geist／Noto Sans SC 与 12px 面板圆角继续复用。
2. `/workspace?tab=` 单页分发改为 85 个独立页面；教师主入口为首页、作业、考试、题库，管理员增加系统管理，学生保留本人首页与学习结果。
3. 试卷、练习册、答题卡各有独立业务编辑器；前两者复用纸张及题目正文基础，答题卡保留独立卡面几何。
4. 官方 ShadCN 基础组件映射现有语义色，与原生字段和既有业务组件并存；此次没有重新制定色彩、字体或通用尺度。
5. 文档只记录方向、实现和证据边界；独立 reviewer 负责 F1–F8 修复复核与最终 disposition。

## 权威顺序与核对证据

本次明确保留现有视觉体系的需求、`structure-refactor.md` 的结构契约，以及当前源码和对应候选截图是本轮依据。PRODUCT 的产品约束和 DESIGN 前置 tokens 继续适用；历史单页路由文字不能覆盖本次结构约定。

| 核对项                 | 证据                                                                                                   | 文档处理                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 冷灰、白、墨色、教学蓝 | `src/app/globals.css` 的原有 root 变量及新 ShadCN 语义变量；DESIGN 前置 colors；sidecar colorMeta      | 保留原 colors，不从截图另取新色，不合并或改名既有 tokens。                                 |
| 字体与中文层级         | `src/app/layout.tsx` 的 Fontsource 引入、global body／h1 规则、DESIGN typography                       | 保留字体和前置层级；只补充新首页汇总值的实际用途。                                         |
| 面板与字段             | 原有 `--radius: 12px`、面板规则；`src/components/ui` 和 `components.json`                              | 保留原尺度，说明 ShadCN 与旧控件并存，避免把旧组件参数套在全部变体上。                     |
| 分组导航与页面         | `src/contracts/navigation.ts`、`shell.tsx`、`src/app/(platform)`、`page-map.json`                      | 更新 PRODUCT、DESIGN 的直接过时说明，并新增当前 surface brief。实测文件计数与清单均为 85。 |
| 角色首页               | `home-pages.tsx`、`admin-pages.tsx`、导航角色分支、reviewer 角色证据                                   | 记录管理员／教师／学生的入口差异，不把教师操作写进学生导航。                               |
| 纸张与业务编辑         | `paper-pages.tsx`、`homework-workbench.tsx`、`document-canvas.tsx`、`document-question.tsx`            | 记录共用正文几何、独立业务状态、卷内快照、作答空间和排版设置。                             |
| 卡面与打印扫描依据     | `card-workbench.tsx`、`src/lib/cards.ts`、`src/server/platform/print.ts`                               | 记录拖动、缩放、坐标、学号区、定位点、多页及保存版式；不承诺实体打印精度。                 |
| 桌面与手机视觉         | `.impeccable/review/structure/{overview,paper,homework,card}-{desktop,mobile}.png` 共 8 张，已直接查看 | 确认视觉延续和构成。截图不证明交互通过，且必须区分候选版本。                               |
| 验收范围               | `structure-acceptance.md`、`structure-ui-review.md` 及 reviewer 原始证据                               | 引用已记录的验证范围；不重复构建，不改 reviewer 报告，不提升其结论。                       |

页面分布为首页／班级 10、作业 23、考试 32、题库 10、学习 6、管理 4。页面数量是本次拆分覆盖范围；各页面操作与异常恢复由验收矩阵及独立审查判断。

## 写入边界与 sidecar

- `PRODUCT.md`：更新产品目的与直接过时的导航、试卷／练习册、考试答题卡能力说明；保留权限、排名、发布、AI 与硬件限制。
- `DESIGN.md`：合并更新外壳尺寸、分组导航、当前基础组件与纸张说明。前置 colors、typography、rounded、spacing、components 原样保留，不重新品牌化。
- `.impeccable/surfaces/platform-app-router.md`：记录当前页面方向、角色导航、三个独立工作台、响应式机制和证据边界。
- `v2-docs/structure-design-notes.md`：记录本次核对依据、文档适用范围和未纳入修复的差异。

本轮是既有 DESIGN 的局部说明合并，没有重新生成 token 系统；因此没有重建 `.impeccable/design.json`。已核对其中色彩元数据、字体元数据和既有组件预览所引用的原 tokens，继续保留全部既有数据。sidecar 的旧控件、扁平导航及学情切换示例只能作为原基础样式的展示，不能作为当前路由树或三个工作台的行为依据；当前页面由新 surface brief 说明。此次没有新增需要抽取为全局 token 的一次性纸张值。

未修改 `.impeccable/config.json`、规则例外、产品代码、历史 surface brief 或独立审查报告。

## 未正规化的差异与限制

旧 `.impeccable/surfaces/src-components-platform-workspace-tsx.md` 指向已拆除的单页组件，列出旧 `?tab=` 路由、扁平导航和学生唯一入口，并含上一轮 ship 结论。本轮保留其历史记录；这些文字不适用于当前结构，不能给新候选背书。

DESIGN 和 sidecar 中原有控件 tokens、旧按钮／字段预览继续描述继承的基础样式。ShadCN size API、全局原生字段样式以及局部工作台规则目前共同决定最终几何；本轮不借文档核对统一其实现。旧 sidecar 的抽屉阴影与 1100px 双列断点也不能解释新的 Sheet 或全部工作台断点。这些差异没有被提炼为新品牌规范。

核对时练习册工具栏使用单栏，分栏操作仅出现在试卷工作台。共用 `DocumentCanvas` 支持分栏不能作为练习册已提供该操作的证据；文档记录当前实现，不把基础组件能力扩展为未提供的界面功能。

独立初轮审查保留了 F1–F8：主要操作文字、未保存后退、键盘缩放、编辑与导出几何、打印栏目、禁用状态、手机纸面操作及练习册说明。第一轮复验已解决 F1、F3、F5、F6、F7、F8；第二轮实际核对确认 F2 的 Back 取消保留 URL 与未保存状态、历史长度和 index 不变，接受后正常返回，重进没有额外历史或确认。F4 的同一练习册在桌面及手机适应宽度约 39%／100%／再次适应宽度下均为 2 页，且每页题目分布相同。证据见 reviewer 的 `verdict2-history.json` 与 `verdict2-layout.json`；最终 disposition 和完整复核范围由 `structure-ui-review.md` 维护，不扩大为全部页面与边界均无缺陷的声明。

根目录旧候选 `homework-mobile.png` 的左侧裁切不作为现存缺陷。reviewer 对当前候选的独立复验记录了手机 `scrollX=0`、整页宽度（390px）、标题左侧位置（16px），确认所测页面没有整页横向溢出；历史截图继续保留为版本证据，不能代替当前候选的结果。

实现证据补充：`DocumentCanvas` 使用隐藏、`aria-hidden`、`inert` 且禁用的固定 1× 测量层计算分页，避免把显示缩放带入测量；`scripts/prepare-print-fonts.mjs` 将应用所用 Fontsource 的 Geist／Noto Sans SC 字体和 CSS 生成到 `public/print-fonts`，打印页实际引用本地资源。第二轮核对确认 CSS 与 woff2 已加载，保存的栏目和作答行数一致；没有新增品牌字体，也不据此承诺实体打印或所有复杂跨页材料均通过。

独立报告中的品牌刻度 advisory、印刷黑线及纸张专用字体属于需要结合用途判断的既有证据，不能自动转化为品牌例外或产品缺陷。本轮未修改 detector 配置，也没有把发现的缺陷正规化为组件标准。

本次只核对文档。自动验证证明其已记录的代码和领域范围；初轮截图、修复截图和最终候选不可混用。实体扫描仪、打印机缩放、可信触摸操作、复杂跨页题目及外部模型质量仍由各自验收范围限定。
