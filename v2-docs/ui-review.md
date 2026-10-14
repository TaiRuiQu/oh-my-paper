## verdict

1. **resolved — 学情筛选范围。** 已重新查看 `student.png`：选择「复合题UI验收作业」后只显示 UI计算 0/2 与 UI证明 3/3，不再混入其他考试知识点。`src/components/platform/analytics.tsx` 的 query key 和请求参数包含考试、班级、学生；切换班级清除学生选择；科目汇总、错题数量与列表共用返回报告。`src/server/platform/scoped-analytics.ts` 在授权范围内重算知识点、科目与错题，同时从完整名单结果保留官方排名及赋分。实际双考试 HTTP 断言与学生页面切换证据记录于 `acceptance-browser.md`；本次审查核对其源码与截图，未重复执行浏览器。
2. **resolved — 键盘创建首个题区。** 已查看 `workbook-keyboard.png`：精确坐标展开，X=0.1 的字段具有可见键盘焦点，页码为 1。`WorkbookCrop` 为每题提供原生「添加第 N 题答题区域」按钮，空列表可创建当前页区域并展开坐标；已有区域禁用重复添加，坐标可修改、区域可移除，页码上限来自上传页数。真实 Enter 创建与坐标同步、两项 UI 回归及无障碍检查证据已记录，原先必须先用指针画框的缺口已解除。
3. **resolved — v2 设计记录。** `DESIGN.md`、`.impeccable/design.json` 与新 surface `.impeccable/surfaces/src-components-platform-workspace-tsx.md` 已以当前 platform 组件为规范，记录九项教师导航、管理员入口、学生单一视图、扫描与键盘框选、逐问评分、统一学情筛选及 AI 状态；旧 shell surface 已删除。原有浅灰、白纸面、蓝色与自托管字体承诺保留。

## remaining

clear — 上轮列出的三项 material fixes 均已解决，本次 ship 仅覆盖这些修复。重新逐张查看 desktop、mobile、student、mixed-review 与 workbook-keyboard 五张图，证据有效，未发现由修复引入的可见回归；公式／表格局部滚动与站内 Markdown 配图限制已按本轮范围核对源码。实体扫描仪、打印与触屏仍属原有未实测边界，本次未独立重跑完整业务验收。

disposition: ship

## 扫描仪批量与表格键盘滚动有限复审（2026-10-14）

**disposition: ship — 仅覆盖本次扫描仪界面接入与表格滚动语义变更。**

已逐张查看 `scanner-desktop.png`（1440×1000）及 `scanner-mobile.png`（390×844），两张均为滚动到扫描仪设置的有效视口。新增纸张来源、DPI、单／双面与页数上限在桌面分组、手机单列展示；中文标签、白纸面、浅灰工作区、蓝色按钮与既定字体体系一致，没有由本次扩展引起的可见布局缺陷。

核对 `src/components/platform/scans.tsx`：不可用设备禁选，自动选择首台可用设备；eSCL 自动进纸请求 `/scan-batch`，其他模式请求单页 `/scan`；请求传递来源、分辨率及双面设置，页数须为 1–100 的整数并受待上传总数限制。返回 PNG／JPEG 保留 MIME、扩展名与采集顺序，先完整校验再加入列表；采集失败保留已有文件。忙碌时设备参数、文件替换与文件移除禁用，避免请求过程中改变文件队列。

核对 platform 所有 `p-table` 包装：均具 `role="region"`、相应中文 `aria-label` 与 `tabIndex={0}`，沿用全局可见焦点和局部 overflow。桌面截图可见扫描记录区域焦点；浏览器证据记录手机方向键滚动 `scrollLeft=37`，页面 body/main 宽度均为 390px。

本次 material fixes：无。证据来自截图、源码、`acceptance-browser.md` 与脱敏 `evidence/scanner-browser.json`，本审查未重新启动浏览器或执行 AI。真实本机 HTTP 模拟 eSCL 与未修改桥接证明软件接入；它不是实体扫描仪验收，也不涉及模型质量结论。手机全页 axe 的版本号对比度 incomplete（开发工具附近）仍按报告保留，主内容范围为 0 violations／0 incomplete。
