# 平台服务契约

`loadState(actor: { id: string }) -> Promise<PlatformState>`；`executeCommand(actor, command) -> Promise<{id: string}>`。actor 只以账号 id 识别，数据库当前 role 为权限权威。接口层取得登录用户并传入；不能接受客户端 ownerId/reviewerId。

共享类型位于 `src/contracts/platform.ts`，`types.ts` 仅提供服务端导出入口。内容写命令为 `{type, question|paper|classroom|student|assessment|template|submission|review}`；删除和发布命令用 `{type,id}`。创建省略 id，修改带 id。执行后前端按当前页面模块重新读取 state。

`paper.rename` 和 `assessment.rename` 使用 `{type,id,name}`，仅接受创建者或系统管理员修改名称（去除首尾空白，1–200 字）。题本名称用于列表与打印标题；安排名称用于本次作业或考试与成绩报告，两者独立。已布置、已有答卷及已发布的记录均可重命名，不重建题目、模板、参试名单或评分。

- question.save 支持 SINGLE/MULTIPLE/BLANK/SUBJECTIVE/MIXED，混合题 parts 各自记录题型、答案、标签、分值。answers 数组分别表达正确选项或各空答案。
- paper.save items 按数组顺序排列，引用 questionId，包含 score、section 和可选 content／question；question 允许卷内独立创建，无需题库记录。可视化编辑只修改当前卷内快照，不改动题库原题。layout 保存 A4/A3、横纵方向、1–4 栏、字体（默认 NSimSun）、自由文字块、页边距、字号、行距和逐题分页／作答行数，画布与打印使用同一份版面数据。
- classroom.save 后 student.save 可用 studentNumber、name 创建学生；userId 或 email 可绑定已注册 STUDENT 账号，不接受任意角色账号。
- assessment.save 的 reviewScope 为 CLASSROOM（默认）或 GRADE。CLASSROOM 为每个班级的任课老师只阅本班对应学科；GRADE 仅用于同一年级的考试，该年级任课老师可阅参与班级对应学科，任教班级无需参试。作业必须使用 CLASSROOM，跨年级不能配置为 GRADE。papers 为 paperId、subject、questionRules（按 PaperItem.id 的 doubleReview/arbitrationEnabled/maxDifference）、gradingMode/arbitrationThreshold、conversion（enabled,bands）。bands 为从高分到低分的累计百分比区间，例如 upperPercent=15,min=86,max=100。
- template.save 使用规范化坐标 CardLayout；regions 引用 PaperItem.id。system presets 只读，选用后按当前题目生成或另存。
- submission.save answers 引用 PaperItem.id，包含 text、images 及可选 box/sourcePage，sourceFiles 保存服务器受控资产 URL。人工没有模板的作业使用 WORKBOOK。
- review.save FIRST/SECOND/ARBITRATION；FIRST/SECOND 可独立先后提交，必须不同教师。逐题启用仲裁且分差严格超过阈值时等待第三教师 ARBITRATION，最终为仲裁与较近原评分的均分，等距以原两评均分为基准。双评 AI 建议须教师确认。ReviewEvent 不可变追加记录每次提交与修订。
- assessment.publish 仅在全部参试学生各科完成评阅后允许发布。学生只能看已发布的本人成绩、错题、分析。

Teacher loadState 返回自己的备课资源，以及教学身份授权范围内的班级、考试与评阅，管理员返回全站；学生没有 users、reviews 和他人数据。analytics 包含多科/班级排名、原始分/赋分、知识点及错题。

考试 `studentIds` 由服务根据布置时班级学生生成，前端不能指定。班级后续加入的学生不进入已有考试，也不能读取已有考试的已发布试卷；名单内学生不能删除。需要修改参试名单时，在尚未上传答卷的场次重新保存安排。

班级 owner/admin 可以编辑班级与学生。教师的教学数据权限由 `teaching_assignments` 独立保存，由系统管理员在「系统管理 → 账号与权限 → 配置教学权限」维护；`user.permissions` 原子替换全部教学身份，空数组表示撤销全部教学数据授权。每次请求读取数据库中的当前账号角色与教学身份，不接受客户端传入权限。

| 教学身份                   | 教学数据范围                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| 学校总管理 `SCHOOL_ADMIN`  | 全校所有班级与学科的考试、作业及成绩；不包含账号、模型等系统配置权限 |
| 年级主任 `GRADE_DIRECTOR`  | 按班级当前年级匹配的全部班级与学科                                   |
| 班主任 `HOMEROOM`          | 指定班级的全部学科                                                   |
| 任课老师 `SUBJECT_TEACHER` | 指定班级的指定学科，可分配多个班级与学科                             |

同一教师可兼任多个身份，权限取并集。未配置身份的教师无法读取班级教学任务与成绩，仍可管理自己的备课资源和创建班级；教师新建班级时自动获得该班班主任身份。系统管理员保留全系统权限，学生仍只能查看本人已发布结果。角色变更会清除已有教学身份，避免账号重新升为教师时恢复陈旧权限。

授权同时用于考试/作业、参试名单、答卷、评阅及历史、成绩、知识点、错题和推荐；同一场考试内按每个班级与学科分别过滤。科目排名与赋分在服务器以完整参试名单计算，再投影到授权范围。仅有部分学科权限时，`totalRestricted` 为 true，全科总分、联合排名、班级排名和全科平均分不返回，界面显示「仅授权学科」。页面与筛选报表再次汇总时继续使用相同授权规则。

参与阅卷的教师根据当前 SUBJECT_TEACHER 身份和 reviewScope 自动确定，无需单独选择双评或仲裁教师；首评、第二评和仲裁共用同一范围，保留不同教师独立评分的约束。系统管理员可阅全校；学校总管理、年级主任和班主任的成绩查看身份不会自动授予任教学科。扫描录入需要对应班级与学科的数据授权，且为班级创建者或本班该学科任课老师；年级跨班阅卷不授予替换答卷的权限。发布和撤回成绩均要求覆盖整场考试的全部班级与学科。

阅卷页面与 AI GRADE 使用独立阅卷数据范围。`GET /api/platform/exams/state?scope=reviewing`（作业为 homework）返回可阅答卷、题目与逐题评分，不返回学情、推荐、全科总分或排名。常规 state 与成绩报表仍使用原教学数据授权，跨班阅卷不扩大报表权限。阅卷配图按当前阅卷范围校验，撤销任课身份后读取和评分均立即失效；AI 提交时再次校验。

`sourceFiles`、作答 `images`/`sourcePage`、题目 `content.images` 和模板区域图片均须引用 `/api/platform/assets/{id}`；命令验证资产所属账号或管理员权限。文件系统路径与外部 URL 不能通过业务命令注入。答题卡模板写入还验证 A4/A3 横纵版式、1–4 栏、四定位点、六位学号、题区不重叠并完整覆盖卷内题目。

AI 执行采用独立 `scripts/ai-worker.ts` 和 PostgreSQL `AiJob` 队列。`enqueueAiJob` 验证资源及当前角色，`claimAiJob` 原子领取并遵守供应商并发，`runClaimedAiJob` 校验 worker 身份并保存事件及结果；超过 90 秒未收到心跳后由领取轮询标记失败，重试创建新任务且只允许本人操作。生产使用 `pnpm build:ai-worker` 打包到 `build/ai-worker`，Docker 提供 `ai-worker` target 和独立 Compose 服务。

已有参试学生未绑定账号时，可以在考试后通过 `student.save` 进行 `userId:null → 已注册STUDENT` 的首次绑定；姓名、学号、班级必须保持不变。首次绑定后可以读取这个学生原有名单内的历史已发布成绩；已有账号不能转绑或解绑。此行为不同于后来新加入班级的学生，后者仍不能读取既有考试。

## AI 自主任务

共享输入定义为 `src/contracts/platform-ai.ts`，六类任务分别为 IMPORT / ENRICH / ASSEMBLE / TEMPLATE / GRADE / RECOMMEND。执行器使用 AI SDK 7 `ToolLoopAgent`，由模型选择检索、读取、查看图片、裁切、提出候选和完成工具；没有预先固定的模型调用工作流。

所有写入候选在内存中暂存，`finish` 校验成功项与明确跳过的不可辨认题目覆盖要求后，才在同一数据库事务写入业务数据、AI 评阅来源及 `AiJob.COMPLETED/result`。跳过项不写入题目或评分，原因保存在 `result.skipped` 并在任务详情展示；全部题目无法辨认也可正常完成。任务行锁和领域锁防止竞争提交；题目更新、作答变更、已有评阅或权限撤回会拒绝过期提交。模型输出不能直接修改所属用户或绕过现有业务校验。

- IMPORT 需查看全部来源、记录逐页题数并批量提出候选；成功题目与明确跳过项必须逐页完整覆盖。图表由模型使用通用 `python` / `shell` 编写代码裁切，工具返回的独立图像可作为暂存资产，整页预览不作为题目配图。裁图文件和资产行随业务提交，失败删除已写文件。无参考答案来源时仍须生成标准答案、解析、考点及主观题评分标准。
- IMPORT 可指定 `kind: HOMEWORK / EXAM`，直接保存含卷内题目快照的练习册／试卷；未指定时仍导入题库。作业入口为 `/homework/import`，完成记录包含 `paperId`、`paperKind`，可继续核对与排版。题目分值来自 `propose_question.score`，综合题使用子题分值总和。

完整执行过程仅在 `/workspace/ai/[id]` 展示，`/workspace/ai` 为本人任务目录；`GET /api/platform/ai/[id]` 按当前用户与任务 ID 双重查询，任务列表同样只返回本人任务。业务页面保留任务状态与链接。公开模型列表仅包含 `id/name`，不返回供应商名称。六类任务都提供受 Bubblewrap 隔离的 `python/shell`，代码与输出随工具事件写入轨迹；沙箱无法访问数据库、服务器环境或网络。全部工具清单与生命周期参见 `docs/agent-tools.zh-CN.md`。

题目读取与报告工具统一接受 `items` 数组并逐项返回成功或详细错误，单条失败保留其他条目结果。同一模型响应可调用多个独立工具并由 SDK 并发执行；OpenAI 显式开启并行工具调用。异常及无效工具调用将具体消息、字段路径和原因反馈给原 Agent，并保存执行记录。管理员可通过 `provider.delete` 删除供应商及关联模型；模型偏好置空，历史任务保留。

PDF 在客户端通过浏览器打印保存，使用预览中的版面与本机字体。`/api/platform/print` 仅接受显式 `format=docx`（试卷／作业的可编辑 Word）或 `format=svg&page=1`（答题卡）。请求 `format=pdf` 或省略格式返回 400。配图继续经现有资产权限读取，`export-assets.ts` 提供 Word 使用的资源加载类型。Word 保留纸张、方向、分栏分隔线、边距、字体、字号、行距、分页、材料图像和手动设置的练习作答线，公式转换为 Office Math；最终分页由打开文档的软件与已安装字体决定。Poppler 仍用于上传 PDF 的页面读取。

- ENRICH 仅可读取和修改指定题的考点、答案、解析及评分标准；保留题干、选项、配图和混合子题编号，已有逐空答案保留空数。配图须先查看。
- ASSEMBLE 从真实题库选择并读取题目，验证学科、年级、准确题型数量、平均难度与知识点分布。百分比通过最大余数法分配整数题数，多标签题使用容量匹配且每题只贡献一次。题库条件无法满足时明确失败，不编造题目；因无法辨认而跳过后不能组卷时，正常结束并在摘要说明未生成试卷。
- TEMPLATE 自主读取整卷题型摘要，按需读取题目正文，生成、调整并提交布局；最终仍受题区覆盖、坐标及重叠校验。
- GRADE 批量读取原题、答案、解析、评分标准和实际作答；有作答图必须逐一查看。混合题须逐小问给分并验证比例上限与总分，结构化存入 `Review.partScores`；结果写入 `Review.source=AI` 和 `aiJobId`，只允许 FIRST，DOUBLE 仍等待独立人工第二评和必要的第三评仲裁。
- RECOMMEND 读取本人或获授权学生的真实错题，从同学科真实题库匹配父题及混合子题知识点；排除本人已提交作答的题，保留尚未作答的组卷题作为候选。推荐要求具体理由和准确数量，并在提交前重新校验学生权限、错题和候选题。

`review.save.partScores=[{partId,score,feedback}]` 对混合题必填，完整覆盖各子题；每问上限为卷内题分乘该子题权重占比，总分必须等于各小问之和。双评平均及仲裁保存对应逐问结果；学情按实际小问标签统计，`wrongPartIds` 仅标记失分小问，正确小问不会因整题失分被误算为薄弱。AI 推题只使用失分小问标签。

## App Router 与业务分层

`src/app/(platform)` 使用真实嵌套路由。平台 layout 负责会话与主导航；六个模块 layout 分别装载经过角色检查的初始数据。客户端导航使用 Next.js Link，页面 URL 可直接打开和刷新。

试卷工作台 (`paper-pages.tsx`)、练习册工作台 (`homework-workbench.tsx`) 和答题卡工作台 (`card-workbench.tsx`) 分别维护自己的业务编辑状态与操作。仅复用纸张几何／分页渲染、基础表单与 ShadCN UI 组件。作业不会使用答题卡，接口和命令层均验证此约束。

- `access.ts`：当前角色、资源归属、班级协作与素材权限。
- `queries.ts`：权限限定的教学数据与正式统计；`page-state.ts`：按考试／作业范围构造页面数据。
- `commands/*.ts`：题目、试卷、班级学生、教学安排、答题卡、作答、评阅七个领域的写入逻辑。
- `service.ts`：命令验证、AI 来源验证和统一数据库事务。
- `/api/platform/[area]/state`：按界面模块读取状态。
- `/api/platform/[area]/commands`：按业务域提交写操作，拒绝命令类型与域不匹配的请求。
- `page-layout.tsx`：服务端页面装载，学生／教师／管理员入口验证。

题库分页接口 `/api/platform/questions` 按 createdAt/id 倒序每页20题，支持搜索与筛选，`id` 单题读取、`stats` 服务端全库统计。页面工作台不携带整库题体，真实数量由 questionCount 返回。

该接口支持 `searchMode=keyword|semantic`，默认为关键词模式。语义模式要求 `q` 为 1–200 字文本，返回同形的 `questions/total/page/pageSize` 及 `searchMode/indexedTotal/warning?`；结果按向量相似度排序，未索引题目不会进入结果。学科、年级、题型和当前账号权限先由 PostgreSQL 筛选，再以当前版本、当前题目 revision 的 point ID 限定 Qdrant 查询；外部调用完成后以单条 SQL 再次验证当前题目与索引状态。管理员可查全站，教师仅查本人，学生拒绝。

`GET /api/platform/admin` 返回 `embedding`（不含密钥，仅 `hasApiKey`）及 `searchIndex`（`total/indexed/pending/failed/enabled/lastError?`）。管理员命令 `embedding.save` 接收 `embedding:{name,apiType:openai|google,baseURL,model,dimensions,apiKey?,enabled}`；首次要求密钥，后续省略则保留。`embedding.reindex` 显式为存量题排队，返回 `{id:'question-bank',queued}`，不在 HTTP 请求内执行模型调用。

outbox 与题目写入同事务持久化，网络／模型调用在 AI Worker 的独立索引循环执行。失败不自动重试付费请求，管理员可重新安排索引；五分钟 PROCESSING 超时转 FAILED。每次修改使用独立 revision point，防止旧请求覆写新向量；更换模型／接口／维度使用独立 version collection，避免混用向量空间。删除保留 tombstone 直至同步，关键词读写完全独立于 Qdrant。

当前语义分页使用 Qdrant exact 检索所有授权候选的分数，再按分数与 ID 稳定排序和分页，避免大量同分向量跨页重复。请求与计算量随候选题数增长，超大题库需进一步优化；生产部署说明见 `docs/deployment.zh-CN.md`。

扫描材料入口 `/api/platform/materials` 支持图片和 PDF，按原页码转换为私有 PNG 页面；`/api/platform/assets` 为配图入口并拒绝 PDF。扫描 `sources` 可按顺序引用已上传私有页面或 multipart 文件编号，也可直接上传原始多页 PDF；PDF 页面数量用于作答框页码与多页卡合并。源文件 30MB，扫描批次展开后最多100页／150MB，AI试卷识别保持20页上限。Web运行环境须提供 `pdfinfo`／`pdftoppm`（Docker已安装poppler-utils），`pnpm run doctor` 可检查。
