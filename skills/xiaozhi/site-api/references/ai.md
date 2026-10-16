# 自主 AI 任务与实时进度

## HTTP

### GET /api/platform/ai

当前用户最近100个任务及公开可用模型：`{models:[{id,name}],jobs:[job]}`；按创建时间倒序。学生可读本人任务。模型 id 必须取实时列表，不能使用显示名称。

### POST /api/platform/ai

JSON `{kind,modelId,input}`，上限1000000字节。成功202 `{id}`，任务仅入队；每人最多10个QUEUED/RUNNING，否则429。学生仅可RECOMMEND/CONSOLIDATE/PRACTICE_GRADE，其余需教师或ADMIN，且要通过对象权限检查。所有模型必须isPublic。先 describe_api(kind) 再发请求。

GRADE 的入队与事务提交使用完整数据库记录核对已有评分；网页盲评投影隐藏他人 FIRST 不表示该答卷可被 AI 覆盖。RECOMMEND/CONSOLIDATE 使用同一对外学习投影，未完成的独立双评题不进入错题、知识点或模型学习上下文。GRADE 写入使用 expectedVersion=0 的未评分基线，处理中出现人工或其他评分后拒绝保存，不得改用新版本覆盖。AI FIRST 仍只算建议，须真人确认后才能完成双评开放条件。

### GET /api/platform/ai/{id}

读取本人job，不因ADMIN身份放宽；不可见404。job主要字段：id,userId,kind,modelId,status,input,result,cost,events,error,attempts,createdAt,startedAt,finishedAt。status=QUEUED|RUNNING|COMPLETED|FAILED。result为各任务实际产物，可能包含包装层；以返回结构为准，再读取对应保存对象确认。job成功不代表自动发布成绩。

### POST /api/platform/ai/{id}/retry

仅本人FAILED任务，其他状态409。重新校验当前权限、输入、模型与排队数量后创建**新任务**，202 `{id}`；后续跟踪新id，旧任务仍FAILED。失败可能已有部分成果，先核实目标，勿无限重试。

## 九类任务输入

| kind           | input                                                                                                                  | 目标与约束                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| IMPORT         | `{assetUrls,subject?,grade?,name?,kind?}`                                                                              | 1..20页本站本人/ADMIN资产；kind=EXAM                                                                                              | HOMEWORK；自主读取试卷、保存题目与卷子 |
| ENRICH         | `{questionIds}`                                                                                                        | 1..100道本人/ADMIN题目；生成答案、解析、评分标准等                                                                                |
| ASSEMBLE       | `{name,subject,grade,difficulty,difficultyTolerance?,counts,knowledgeDistribution,kind?}`                              | difficulty和tolerance=0..1，tolerance默认0.2；自主在授权题库选择题组卷，kind默认EXAM                                              |
| TEMPLATE       | `{paperId,name?}`                                                                                                      | 本人/ADMIN试卷的自主答题卡任务；区别于确定性 POST /templates                                                                      |
| GRADE          | `{assessmentId,classroomId,paperId,rosterRevision,templateId?,assetUrls?,pagesPerStudent?,studentIds?,submissionIds?}` | 自主识别与评分并保留AI来源；必须有对应学科阅卷权限，考试未发布；上传页与已录入submissionIds两种模式不能混用                       |
| RECOMMEND      | `{studentId?,count?,subject?}`                                                                                         | 按当前可见学生报告与错题推荐，count=1..20默认5；无studentId时取首个可见报告；多人范围应显式指定                                   |
| CONSOLIDATE    | `{studentId,name,subject,sources,count?,score?}`                                                                       | 从授权错题生成巩固卷；sources=[{assessmentId,itemId}]，1..500条且唯一；count=1..20默认5，score>0且<=100默认5；候选未作答题不足422 |
| LESSON_PREPARE | `{sessionId,publicationId,expectedVersion,expectedPlanVersion,expectedBindingVersion,requirements}`                    | 授课教师或教务管理者为本人可准备课堂生成候选教案，版本均必填非负整数；不确认、不点名、不开始或结束课堂                            |

| PRACTICE_GRADE | `{attemptId,sessionId?,expectedEvaluationVersion,attemptFingerprint,contentFingerprint}` | 自主批阅已提交的冻结练习；固定指纹与反馈基线，保存AI_CANDIDATE，教师核验单独进行，不修改正式评分 |

ASSEMBLE.counts：1..5项 `{type,count:1..100,score:>0且<=10000,section?}`，题型不能重复；knowledgeDistribution：1..30项 `{tag,percent:>0且<=100}`，tag唯一且总比例100%。grade是字符串，知识标签应参考教材 Skill 并与题库实际标签比对。不能假设每本教材都自动对应题库的知识标签。

GRADE 上传模式：assetUrls最多100且不重复；须同时给studentIds指定每组学生顺序，pagesPerStudent=1..100可选；学生id不能重复，页数/组数/模板须与实际材料一致。无assetUrls时不得给studentIds或pagesPerStudent。submissionIds可选1..500且不重复；无上传页时可按现有答卷范围批改，按需显式指定避免过大范围。学生和作答范围以服务端 gradingContext 为准，只允许已确认名单中该科 REQUIRED 的学生；rosterRevision 必填并须等于当前版本。入队及事务提交均重新核对名单版本，处理中名单变化将409拒绝保存，须重新核对后创建任务。缺考、免考、退出不得通过省略studentIds绕过。

LESSON_PREPARE 先从课堂详情读取session及当前绑定发布ID、课堂版本、教案版本、绑定版本；requirements可为空但字段必填。入队及事务提交都重验当前角色、课堂权限和基线，手工改稿、课表重发或重新绑定使旧任务409。重试仍沿用原输入基线，不自动换新版本；冲突应重新读取并比较，由用户明确发起新任务。Agent自行决定读取课程/教案、搜索授权题库、阅读题目和真实图片的顺序；教务任课不扩大题库或考试学情权限，模型上下文不含点名名单、缺勤说明或其他教师私有记录。可显式读取并复用当前教案已授权的冻结材料，不跟随题库后续改删；复用所含图片仍须真实查看。提案只保存不可变AI候选教案草稿和来源；结果可返回sessionId/planVersion，并链接课堂详情供教师核对编辑确认。COMPLETED不表示已经授课。

等待使用 `wait_for_task({id,seconds:20})`，若QUEUED/RUNNING则继续按需等待。只有COMPLETED且结果可用才开展依赖操作；FAILED时读取error并决定是否更正输入/补充材料/重试。自主任务不是固定工作流，模型自行选工具观察、推理、保存与结束。

## 前端 SSE（小纸不能 website_request）

### GET /api/platform/ai/events

本人全部任务/可用模型快照；不是全校任务。

### GET /api/platform/ai/{id}/events

本人单任务快照，终态快照后关闭。

### GET /api/platform/admin/ai-progress

仅ADMIN；用于向量检索配置/索引进度，返回models/jobs空数组及searchConfiguration；不是所有用户AI任务列表。

三者 query `format=json|protobuf`，默认来自AI_PROGRESS_FORMAT配置。HTTP Content-Type为text/event-stream；JSON事件 `snapshot` 的data是 `{models,jobs,searchConfiguration?}`；protobuf事件 `snapshot-protobuf` 的data是编码后的字符串，由站点codec解码，不能当作JSON。heartbeat是注释，不是结果；连接最多5分钟或会话到期，可能204（已取消）。慢连接/订阅故障会关闭；重新连接获取最新全量快照，不支持按增量事件重放推断结果。小纸使用GET任务详情或wait_for_task，事件由界面订阅。

源码：`src/contracts/{platform-ai,ai-progress,revision-papers}.ts`、`src/server/platform/{ai-jobs,ai-progress,grading}.ts`、`src/server/platform/ai/`、`src/lib/ai-progress-codec.ts`。

线上作业 GRADE 的固定提交轮次、不可变原稿、退回重交与成绩发布边界见 [作业收交](homework.md)。无上传材料的任务入队时保存当时的 submissionIds；后续重交不能被旧任务自动采用，线上原始文字和图片不能被 record_answers 改写。

PRACTICE_GRADE的权限、曝光与图片边界见[自主练习](practice.md)。该类公共任务的input/result为null、events为空，只公开安全practice标识／反馈链接与计数；GET、SSE JSON／protobuf和小纸等待一致。不能从内部sandbox输出读取标准答案。任务失败保留原基线，人工核验后过期任务409；需新评阅应重新读取再明确发起。
