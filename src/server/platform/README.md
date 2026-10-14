# 新平台服务契约

`loadState(actor: { id: string }) -> Promise<PlatformState>`；`executeCommand(actor, command) -> Promise<{id: string}>`。actor 只以账号 id 识别，数据库当前 role 为权限权威。接口层取得登录用户并传入；不能接受客户端 ownerId/reviewerId。

类型定义位于 `types.ts`。写命令均为 `{type, question|paper|classroom|student|assessment|template|submission|review}`；删除和发布命令用 `{type,id}`。创建省略 id，修改带 id。执行后前端重新 GET state。

- question.save 支持 SINGLE/MULTIPLE/BLANK/SUBJECTIVE/MIXED，混合题 parts 各自记录题型、答案、标签、分值。answers 数组分别表达正确选项或各空答案。
- paper.save items 按数组顺序排列，引用 questionId，包含 score 和 section；服务端保存题目快照。
- classroom.save 后 student.save 可用 studentNumber、name 创建学生；userId 或 email 可绑定已注册 STUDENT 账号，不接受任意角色账号。
- assessment.save papers 为 paperId、subject、gradingMode、arbitrationThreshold、conversion（enabled,bands）。bands 为从高分到低分的累计百分比区间，例如 upperPercent=15,min=86,max=100。
- template.save 使用规范化坐标 CardLayout；regions 引用 PaperItem.id。system presets 只读，选用后按当前题目生成或另存。
- submission.save answers 引用 PaperItem.id，包含 text、images 及可选 box/sourcePage，sourceFiles 保存服务器受控资产 URL。人工没有模板的作业使用 WORKBOOK。
- review.save FIRST/SECOND/ARBITRATION；SECOND 必须不同评阅者，分差超阈值自动等待 ARBITRATION；仲裁须第三评阅者。
- assessment.publish 仅在全部参试学生各科完成评阅后允许发布。学生只能看已发布的本人成绩、错题、分析。

Teacher loadState 返回自己的题库、班级、考试及其评阅，管理员返回全站；学生没有 users、reviews 和他人数据。analytics 包含多科/班级排名、原始分/赋分、知识点及错题。

考试 `studentIds` 由服务根据布置时班级学生生成，前端不能指定。班级后续加入的学生不进入已有考试，也不能读取已有考试的已发布试卷；名单内学生不能删除。需要修改参试名单时，在尚未上传答卷的场次重新保存安排。

班级 owner/admin 可以编辑班级与学生，`reviewerIds` 仅授予该班级的读取、扫描与评阅权限。跨班联考排名在服务端按完整名单计算，再按当前教师的授权班级或当前学生身份过滤；共享教师不能读取或评阅同一场次内未共享班级的答卷。学生 state 中的班级成员、参试 ID、成绩和错题都仅含本人。

`sourceFiles`、作答 `images`/`sourcePage`、题目 `content.images` 和模板区域图片均须引用 `/api/platform/assets/{id}`；命令验证资产所属账号或管理员权限。文件系统路径与外部 URL 不能通过业务命令注入。答题卡模板写入还验证 A4 四定位点、六位学号、题区不重叠并完整覆盖卷内题目。

验证入口：`pnpm test:integration` 使用独立 PostgreSQL schema，覆盖五题型、两科两学生、题库快照、双评仲裁、排名赋分、并列排名、完整发布条件、资产授权、共享班级边界以及后续转入学生的历史隔离；`tests/platform-domain.test.ts` 覆盖评分、知识点、推荐与命令约束。扫描像素与上传验收由 `pnpm test:scan` 独立执行。

AI 执行采用独立 `scripts/ai-worker.ts` 和 PostgreSQL `AiJob` 队列，不使用旧版 Worker / pg-boss。`enqueueAiJob` 验证资源及当前角色，`claimAiJob` 原子领取并遵守供应商并发，`runClaimedAiJob` 校验 worker 身份并保存事件及结果；超过 90 秒未收到心跳后由领取轮询标记失败，重试创建新任务且只允许本人操作。验证入口 `pnpm test:ai-jobs` 使用真实隔离数据库和可注入测试 runner，覆盖队列安全和持久化，不证明真实模型任务质量。生产使用 `pnpm build:ai-worker` 打包到 `build/ai-worker`，Docker 提供 `ai-worker` target 和独立 Compose 服务。

已有参试学生未绑定账号时，可以在考试后通过 `student.save` 进行 `userId:null → 已注册STUDENT` 的首次绑定；姓名、学号、班级必须保持不变。首次绑定后可以读取这个学生原有名单内的历史已发布成绩；已有账号不能转绑或解绑。此行为不同于后来新加入班级的学生，后者仍不能读取既有考试。

## AI 自主任务

共享输入定义为 `src/contracts/platform-ai.ts`，六类任务分别为 IMPORT / ENRICH / ASSEMBLE / TEMPLATE / GRADE / RECOMMEND。执行器使用 AI SDK 7 `ToolLoopAgent`，由模型选择检索、读取、查看图片、裁切、提出候选和完成工具；没有预先固定的模型调用工作流。

所有写入候选在内存中暂存，`finish` 校验完整覆盖后才在同一数据库事务写入业务数据、AI 评阅来源及 `AiJob.COMPLETED/result`。任务行锁和领域锁防止竞争提交；题目更新、作答变更、已有评阅或权限撤回会拒绝过期提交。中途失败不留下半套题库、组卷或评分。模型输出不能直接修改所属用户或跳过现有业务校验。

- IMPORT 先查看全部来源、记录逐页题数，再逐题提出候选；必须逐页完整覆盖。图表通过 `crop_material` 实际裁切成独立资产，禁止将整页来源图片作为题目配图。裁图文件和资产行随业务提交，失败删除已写文件。无参考答案来源时仍须生成标准答案、解析、考点及主观题评分标准。
- ENRICH 仅可读取和修改指定题的考点、答案、解析及评分标准；保留题干、选项、配图和混合子题编号，已有逐空答案保留空数。配图须先查看。
- ASSEMBLE 从真实题库选择并读取题目，验证学科、年级、准确题型数量、平均难度与知识点分布。百分比通过最大余数法分配整数题数，多标签题使用容量匹配且每题只贡献一次。无法满足时明确失败，不编造题目。
- TEMPLATE 自主读取整卷题型摘要，按需读取题目正文，生成、调整并提交布局；最终仍受题区覆盖、坐标及重叠校验。
- GRADE 逐题读取原题、答案、解析、评分标准和实际作答；有作答图必须逐一查看。混合题须逐小问给分并验证比例上限与总分，结构化存入 `Review.partScores`；结果写入 `Review.source=AI` 和 `aiJobId`，只允许 FIRST，DOUBLE 仍等待独立人工第二评和必要的第三评仲裁。
- RECOMMEND 读取本人或获授权学生的真实错题，从同学科真实题库匹配父题及混合子题知识点；排除本人已提交作答的题，保留尚未作答的组卷题作为候选。推荐要求具体理由和准确数量，并在提交前重新校验学生权限、错题和候选题。

`pnpm run test:ai-domain` 在真实隔离 PostgreSQL 验证裁图持久化、AI 首评来源、人工独立第二评、过期数据保护和原子失败回滚；不调用外部模型。`tests/platform-ai.test.ts` 验证工具边界、完整性和真实 SDK 自主多轮执行。真实模型质量另由 `scripts/test-ai-live.ts` 及其最新证据验证；不可用模拟工具或旧版本运行结果替代当前代码的外部模型验收。

迁移 `20261014040000_review_part_scores` 新增结构化混合题小问评分。`review.save.partScores=[{partId,score,feedback}]` 对混合题必填，完整覆盖各子题；每问上限为卷内题分乘该子题权重占比，总分必须等于各小问之和。双评平均及仲裁保存对应逐问结果；学情按实际小问标签统计，`wrongPartIds` 仅标记失分小问，正确小问不会因整题失分被误算为薄弱。AI 推题只使用失分小问标签。
