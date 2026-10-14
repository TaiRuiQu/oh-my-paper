# 工作台、答题卡与逐题双评验收

2026-10-14。保留 Next.js App Router 及试卷、作业、答题卡各自独立的业务工作台。

## 本轮交付

- 顶部账户导航固定在滚动视口顶部。侧栏分组展开／收起和箭头具有 220ms 动画，路由内容用 180ms 动画切换；遵循减少动态效果设置。整组 hover 覆盖下拉箭头。路由动画保留 DomainProvider 状态。
- 三种排版工作台默认占满主区宽度，按桌面 Word 式纸面、工具栏、目录／属性组织。试卷和练习册支持自行创建题目、自由文字材料和从题库导入单题；自行创建的题目只保存在文档快照中。答题卡独立编辑题区、附加文字、定位点和考号，并提供前往对应试卷添加题目的入口。
- 文档字体默认 `NSimSun`，可选择新宋体、宋体、黑体、微软雅黑、思源宋体、Arial、Times New Roman。字体使用本机安装版本，未安装时回退到可用的宋体类字体。应用导航继续沿用界面字体。
- 年级为分组选择：小学一至六年级，初中一至四年级，高中一至三年级；旧的高一／初一等显示值规范化。
- 试卷、练习册与答题卡均支持 A4／A3、横向／纵向、1–4 栏。保存数据同时驱动画布与打印。
- 参考 `examples/数学答题卡_正.jpeg` 与背面样板，卡面使用明确的红色外框及分栏、黑色题区边框、题号、矩形选项与考号填涂框。预览和打印共用 SVG；扫描端按相同坐标识别，旧版扫描几何仍保留识别分支。
- 卡片附加文字采用一致的纯文字换行规则，SVG 限制每行实际宽度，自动增加区域高度；后端检查文字高度及定位点、考号、识别码、选择题填涂区的覆盖冲突。格式切换重新定位纸内文字，无法容纳时保留当前版式并给出提示。

## 题库规模

`GET /api/platform/questions` 每页 20 题，按 `createdAt DESC, id DESC` 排列；支持学科、年级、题型、题干／知识点搜索。旧题修改不会前移。题目详情按 ID 独立读取，分析由服务端统计。题库列表、导入选择、AI 答案生成的选题均分页。

工作台页面 state 的 `questions` 为空，通过 `questionCount` 展示真实数量，防止整库题体注入页面。数据库新增 `(ownerId, createdAt, id)` 索引。隔离 PostgreSQL schema 中实际加入 10,000 题，验证 20 条分页、页间顺序、修改稳定性、权限、年级检索、全库统计及工作台 state 不携带题体；最后一次专项检查总用时约 246ms，作为本机测试记录，不代表部署环境的性能保证。

## 双评与仲裁

每道题单独设置 `doubleReview`、`arbitrationEnabled`、`maxDifference`。两个不同教师可独立提交 FIRST／SECOND，第二评可以先完成。未启用仲裁或分差未超过阈值时，取两位教师平均分。严格超过阈值后，需要第三位独立教师仲裁，取仲裁分和更接近的原评分的均分。恰好等距时，以两位原教师的均分为基准再与仲裁分平均。浮点比较使用机器精度容差。

混合题保留每个小问的评分，按同一评阅组合计算小问均分。双评题 AI 首评仅作为建议，须第一位教师人工确认后再与第二位教师评分形成正式成绩；AI 不执行第二评和仲裁。

`Review` 保存每轮当前评分，`ReviewEvent` 追加保存每次提交的教师、轮次、分值、小问分、来源、反馈、AI 任务及时间。历史评分在迁移中回填。评分修改不覆盖历史，仲裁完成后不能改动前两评，发布后不能重评。界面提供计分依据与完整评阅记录。

迁移：`prisma/migrations/20261015000000_workbench_review_rules/migration.sql`，已应用到本地数据库。

## 验证

- `pnpm check`：格式、ESLint、TypeScript、85 项单元测试通过，包括真实 React Portal 表单提交回归、16 种版式、自由文字／题目、双评规则、浮点平距及文字高度。
- `pnpm test:integration`：真实隔离 PostgreSQL 验证逐题规则、第二评先提交、三位不同教师、仲裁较近均分、评分修改历史、单评题限制、用户权限、10,000 题分页与统计。
- `pnpm test:scan`：真实打印像素和 OpenCV，含 A4／A3 × 横向／纵向四栏矩形填涂、考号与选项、多页乱序、透视旋转、重传保护及人工裁切。
- `pnpm test:ai-domain`：AI 建议、教师确认、独立第二评及混合题小问分持久化、事务回滚通过；没有调用外部模型。
- 最终生产构建、Worker 构建及服务重启结果见下方运行记录。

## 独立 Sub-Agent 复验

在实现后重新启动 `/root/workbench_independent_review`，只读审查代码、实际浏览器、持久化接口和打印 SVG。复验发现的 Portal 表单冒泡、路由动画重建上下文、原评分轮次恢复、已完成仲裁选项、小数等距、注释换行／高度、窄纸格式切换和宽 ASCII 字符问题均已修复并复测。

最终结论：已检查范围内没有剩余 P1／P2 阻断，可交付。浏览器验证包含新卷保存立即打开、作业独立文字、字体／年级／版面恢复、评分 3→4 修订与两次历史、卡片格式切换、打印换行及全部 16 种默认注释版式。三位教师完整评分由主代理数据库集成覆盖；未进行实体扫描仪或外部模型验收。

截图保存在 [evidence/workbench-v3](evidence/workbench-v3)：

- [试卷工作台](evidence/workbench-v3/omp-independent-paper-new.png)
- [逐题导入](evidence/workbench-v3/omp-independent-bank-picker.png)
- [作业文字](evidence/workbench-v3/omp-independent-homework-text.png)
- [评分历史](evidence/workbench-v3/omp-independent-review-history.png)
- [答题卡](evidence/workbench-v3/omp-independent-card-fixed-final.png)
- [答题卡打印](evidence/workbench-v3/omp-independent-card-print.png)

## 运行记录

- 最终 `pnpm build` 成功；`pnpm build:ai-worker` 成功，打包 451 个运行时依赖文件。
- 服务已重启为构建后的 standalone Web，地址 `http://localhost:3000`。健康检查返回 200；真实已登录浏览器再次确认固定顶栏、全宽工作台、NSimSun 字体、A3 横向纸面和答题卡。
- `pnpm test:http` 在重启后的 standalone 服务通过，覆盖真实注册／登录、管理员授予角色、学生限制、CSRF、资源权限、题目→试卷→答题卡→作答→评分→发布→私有学情，以及筛选与正式排名。
- 生产版本题库 API 返回按页题目，考试工作台 state 题库题体数量为 0；浏览器没有新增运行错误。
- `git diff --check` 通过；Impeccable 本轮 UI detector 没有 findings。
- AI Worker 完成构建，本轮没有启动外部模型任务。字体未安装时使用回退字体，未随应用分发微软字体。
