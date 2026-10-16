# 业务数据、题库、分析与命令

读取采用当前会话权限；所有命令均需教师或管理员。参数的精确 schema 通过 describe_api 操作名读取，所有命令成功返回 `{id,credentials?}`。`id` 的对象类型取决于操作，不能把 questionId、paper.items[].id（itemId）、studentId（班级学生记录）或 userId（登录账号）互换。

## 状态与检索 HTTP

### GET /api/platform

返回 PlatformState：actor、classrooms（内含 students，绑定账号的学生另附 `userLogin` 登录名，由服务端按名单解析）、questions、papers、assessments、templates、submissions、reviews、可选reviewHistory/reviewAssignments/reviewing、analytics、users（仅教职员 ADMIN/TEACHER 账号；学生响应为空；ADMIN 另附 `usersTotal` 全校账号总数）。学生账号不随 state 全量下发，查找账号一律用 GET /api/platform/users 按需搜索。已按教学身份/本人数据/成绩发布状态过滤；该完整状态会加载当前身份可见题库，但工具响应可能截断；不能将截断结果当作完整题库。大响应先用工具 select 选择字段并分页；完整题库用独立 questions 接口。

双评按题独立保护：未发布且第一、第二评尚未由两位不同真人完成时，`reviewAssignments[].blind=true`；`reviews` 和 `reviewHistory` 仅含当前账号本人的评分，不含他人的分数、反馈、小问分数或历史。AI FIRST 不算真人完成。管理员、学校总管理、年级主任和班主任也遵守这项隔离。两位真人均已提交后，授权用户可查看前两评、历史、结果及仲裁依据；单评不受此项额外限制，学生仍仅看本人已发布结果且不返回教师评阅记录。

`reviewAssignments=[{submissionId,itemId,blind,rounds:[{round,reviewerId,source?}],availableRounds:[{round,label,reason}]}]` 是无分数元数据。`source` 为 HUMAN/AI（省略按真人记录处理）；`reason=null` 表示当前账号可执行该轮次，否则是不可执行原因。名单 NEEDS_REVIEW 或该科不是 REQUIRED 时，所有轮次均返回暂停原因，保留已有占用和盲评元数据；网站保留评分草稿但禁止提交。轮次是否被占用必须从 `rounds` / `availableRounds` 判断，不能将过滤后 `reviews` 中缺少其他教师记录当作空闲。写入仍按实时权限和状态校验，元数据不保证稍后的写入必定成功。

盲评题在 `analytics` 中不返回得分、反馈、小问分数或计算依据；对应科目原始分/赋分/排名及总分/总排名为空，知识点、错题和其他学习聚合不计入该题，防止通过汇总反推他人分数。保留题目满分及不含分数的评阅进度。HTTP 完整状态、模块状态、SSR 初始页面及小纸 `website_request` 使用相同投影；工具 `select` 仅裁剪已授权响应，不能恢复隐藏字段。以上规则不改变发布检查和 AI GRADE 对完整数据库记录的内部校验。

每份 assessment 的 `canManage` 为服务端基于完整原始科目与当前授权计算的管理权限，前端不可仅按 ownerId 或已裁剪 papers 推断。

每份 assessment 包含持久化的 `rosterRevision`（正整数）、`rosterStatus=CONFIRMED|NEEDS_REVIEW`、`participants`。参与成员为 `{id,studentId,classroomId,classroomName,name,studentNumber,stage,cohort,subjects:[{paperId,status,reason}]}`；身份与班级字段是本次快照，不能用当前 `classrooms[].students` 替代。逐科 `status=REQUIRED|ABSENT|EXEMPT|WITHDRAWN` 表示应考、缺考、免考、退出。报告每科同时返回 `participationStatus/participationReason`；非应考不记零分、不进入该科赋分与排名，存在非应考科目时不与完整全科成绩混排总分。

历史安排由现存班级/答卷重建候选名单，状态为 NEEDS_REVIEW；这不证明历史实际参试名单。创建者或管理员必须人工核对后用 `assessment.roster.update` 明确确认，扫描、批改和发布才开放。名单变更不删除已有答卷或评分；停止参与的科目不进入当前成绩计算。名单版本每次实际变更递增；客户端持有旧版本不得静默覆盖新名单。

### GET /api/platform/roster-history

只读名单变更历史；网站和小纸 `website_request` 均可按当前会话调用。query：`assessmentId` 必填，`beforeRevision` 可选正整数（只读严格小于此版本），`limit` 为1..50、默认20。需要登录；学生403，教师须原有班级/学科数据查看权限，无权或不存在为404，参数错误400。不因读取审计而授予管理、跨班阅卷或其他学科权限。无写入、异步任务或SSE；响应 `Cache-Control: private, no-store`。

返回 `{assessmentId,currentRevision,scopeRestricted,events,nextBeforeRevision}`。`events` 按版本倒序，包含 `{id,revision,createdAt,actorName,reason,confirmedReconstruction,reconstructedCandidate,entries}`；`reconstructedCandidate=true` 明确表示系统迁移重建的待核对候选名单，不是原始参试事实或人工确认；这类事件的actorName为“系统迁移”。`actorName` 为操作账号当前姓名（账号已删除时标明），不伪称操作时姓名快照。`entries` 为 `{studentId,name,studentNumber,classroomId,classroomName,paperId,subject,beforeStatus,status,reason,kind}`；`kind=ADDED|STATUS_CHANGED`，加入时beforeStatus=null，其余为原参与状态。学生身份取本次名单/事件快照；科目取试卷关联，禁止解析或推断隐藏范围。历史范围调整保留早已退出的原原因，不重复描述为本次退出。

返回的是逐项授权投影，不返回原始 `changes`、其他班级/学科的学生或原因。部分授权时整体原因及全局重建确认不展示，相关范围调整原因明确标为仅完整授权可见。某页可能没有授权事件但仍有 `nextBeforeRevision`；需按该游标继续查询，不能把这一页当作全部历史。没有下一页时为null。读取分页期间名单版本变化时，界面要求从最新页重新核对，不把不同版本页静默拼接。

### POST /api/platform

JSON 为下表任一业务命令，type 判别；请求体上限2000000字节。保存命令带 id 是更新，不带为创建；保存是完整对象输入，不是任意字段的 PATCH。

### GET /api/platform/{area}/state

area 只能是 workspace/homework/exams/questions/learning/admin。query 可用 `scope=reviewing`，但仅 exams/homework 接受，否则400。返回 PlatformState，沿用上述双评隔离及无分数 `reviewAssignments`；exams/homework 分别过滤 EXAM/HOMEWORK，homework 不返回答题卡。页面状态一般不加载题库（questionLimit=0，learning 例外），题库需要单独请求。学生只允许 workspace/learning，admin 仅管理员。

仅 `exams/homework` 的 `scope=reviewing` 可附 `requestedSubmissionId`（非空、最长128字符）明确读取单份已退回或被新提交替代的答卷；其他范围使用该参数400，学生读取阅卷范围403。当前仍有对应班级、考试范围和学科阅卷权限时，返回独立 `requestedReview:{submission,reviews,reviewHistory,reviewAssignments}`；评分与历史仍沿用相同盲评规则，所有可执行轮次标为不可写。此记录不加入 `submissions` 当前队列、正式成绩或分析。当前答卷仍有效时照常在 `submissions`，不复制到 `requestedReview`；不存在、跨考试种类或已撤权时不返回该独立字段，也不以别的答卷回退代替。前端可保留本人在本页修改的纯本地评分文字，但不能把旧缓存的题面、学生作答或服务器评分当作当前已授权数据。旧提交任何 `review.save` 仍409，须查看收交历史及当前队列后处理新提交，不自动迁移评分草稿。

### GET /api/platform/users

按需账号目录搜索；完整 state 的 `users` 只含教职员，查找或绑定账号必须走此接口。仅教师/管理员，学生403。query：`query` 为姓名/登录账号 username/邮箱的子串关键词（大小写不敏感，去空白后最长64字符，超长400）、可选 `role=ADMIN|TEACHER|STUDENT`（其他值400）、或 `id` 精确读取单账号（与 `query` 同用400）。数据范围与授权一致：管理员可搜全校，教师仅教职员与可见班级的学生账号；id 不存在或不在范围内404。响应 `{users,total}`：`users` 按创建时间降序最多200条，含 `{id,name,email,username,role}`，ADMIN 响应另含 `teachingAssignments` 与 `permissionsVersion`；`total` 是范围内的匹配总数，可能大于返回条数，此时应继续缩小关键词而不是翻页假设。无写入、分页游标或异步行为；`Cache-Control: private, no-store`。为 `student.save` 绑定已有学生账号时，先用 `role=STUDENT` 加关键词取得 userId，再把该 userId 交给命令。

### POST /api/platform/{area}/commands

与 POST /api/platform 同一 schema/响应和2000000字节限制，但 area 限制 type 前缀：questions→question；papers→paper；classrooms→classroom/student；assessments→assessment；templates→template；submissions→submission；reviews→review。模块不匹配400。不要把 state area 和 commands area 混为一组。

### GET /api/platform/questions

仅教师/管理员。普通教师仅本人题目，管理员全库。page 默认1，整数1..100000（即使 stats/id 模式也校验）；每页固定20。优先级：query 中出现 stats（包括 stats=0）→统计；其次出现 id→单题；否则分页检索。

- stats 响应：`{total,subjects,types,missingAnswers,missingExplanations,tags:[{tag,count,subjects,difficulty}]}`。
- id 响应：`{question}`，不可见404。
- 检索 query：subject、grade、type（SINGLE/MULTIPLE/BLANK/SUBJECTIVE/MIXED）、q、searchMode。searchMode 默认 keyword；keyword 匹配题干子串或完整知识标签，q去空白后截取200字符。semantic 的 q 必须1..200字符；需管理员启用向量模型，否则409。只搜当前版本已索引记录。
- 分页响应：`{questions,total,page,pageSize:20,searchMode,indexedTotal?,warning?}`。semantic 的 total 是索引候选数，warning 可提示尚未索引数量；无结果不等于无对应题目。

### GET /api/platform/analytics

query 可选 assessmentId、classroomId、studentId、kind=EXAM|HOMEWORK（其他kind按未设置处理）。返回 Analytics：results、classrooms、students、knowledge；students 报告含错题、知识点和推荐，实际字段依实时数据。筛选 id 必须在当前可见 state 内，否则404。保留全考试范围的官方赋分与联考排名；不能把筛选后的样本另算为官方排名。所有筛选范围均遵守盲评题隔离，官方成绩合并不会恢复被隐藏的字段；学生响应不含班级聚合。成绩、错题来源和 itemId 从此结果取值。

## 全部16个业务命令

以下输入均有 `type`。数字分值通常0..10000，id非空最长128。题名 name 非空且最多200字符；大文本通常最多100000字符；知识标签最多100个、每个1..120字符、自动去重。操作特有嵌套必填字段以 describe_api 为准。

| 操作名 / 对应 commands area            | JSON 除 type 外字段                                                                                                       | 权限、行为与冲突                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| question.save / questions              | question:{id?,type,subject,grade,difficulty,knowledgeTags,content}                                                        | 本人或ADMIN；difficulty=0..1；content 完整字段见下文；引用图需本人/ADMIN资产                                                                                                                                     |
| question.delete / questions            | id                                                                                                                        | 本人或ADMIN；试卷快照与题库题目区别，勿将删题当作删试卷                                                                                                                                                          |
| paper.save / papers                    | paper:{id?,name,kind,subject,grade,instructions,layout,items}                                                             | 本人或ADMIN；题目学科必须与试卷一致；已用于考试/作业或参试名单历史的卷不能覆盖，另存新卷；更改题序/题型/选项结构会删除旧模板                                                                                     |
| paper.delete / papers                  | id                                                                                                                        | 本人或ADMIN；已布置或仍被参试名单历史引用的试卷409                                                                                                                                                               |
| paper.rename / papers                  | id,name                                                                                                                   | 本人或ADMIN，仅改名称                                                                                                                                                                                            |
| classroom.save / classrooms            | classroom:{id?,name,stage,cohort}                                                                                         | 本人或ADMIN；stage=小学/初中/高中；新建教师班级自动创建HOMEROOM身份，并推进该教师permissionsVersion及保存权限变更审计；已有任课老师时改学段/届别需ADMIN                                                          |
| student.save / classrooms              | student:{id?,classroomId,studentNumber?,name,userId?}                                                                     | 班级owner或ADMIN；省略学号自动生成；省略userId一般创建托管账号，显式null可保留未绑定名册；已有绑定不可解绑；已参试身份受保护；可能返回credentials                                                                |
| student.delete / classrooms            | id                                                                                                                        | 班级owner或ADMIN；已在参试快照或答卷中引用的学生不可删（409）                                                                                                                                                    |
| assessment.save / assessments          | assessment:{id?,name,kind,reviewScope?,classroomIds,papers,expectedRosterRevision?,rosterStudentIds?,rosterChangeReason?} | 本人或ADMIN，所有班级和学科须授权；已有答卷不可调整；GRADE联考班级同学段同届别；作业仅CLASSROOM；papers须本人/ADMIN且非空、科目用途一致；新建保存名单快照，已有安排改变班级或paperId集合须显式携带三个roster参数 |
| assessment.publish / assessments       | id,published:boolean                                                                                                      | 本人或ADMIN且仍完整可见；发布需名单已确认且所有应考科目评阅完成，否则409；缺考/免考/退出不作为零分；false为撤回发布                                                                                              |
| assessment.roster.update / assessments | id,expectedRevision,reason,addStudentIds?,changes?,confirmReconstruction?                                                 | 创建者或ADMIN且完整授权；已发布409；版本冲突409；显式补充学生、逐科状态与原因，保留答卷和评分，记录变更历史                                                                                                      |
| assessment.rename / assessments        | id,name                                                                                                                   | 完整范围仍授权的创建者或ADMIN，仅改名称                                                                                                                                                                          |
| template.save / templates              | template:{id?,paperId,name,subject,layout},paperDraft?                                                                    | 本人或ADMIN；仅EXAM，模板完整覆盖每题；预设不可改；已扫描模板不可改；paperDraft会另建修订试卷并映射itemId                                                                                                        |
| template.delete / templates            | id                                                                                                                        | 本人或ADMIN；预设或已使用模板不可删                                                                                                                                                                              |
| submission.save / submissions          | submission:{id?,assessmentId,paperId,studentId,rosterRevision,templateId?,kind,sourceFiles,answers,alignment?}            | 需班级/学科作答管理权限；考试未发布、名单CONFIRMED且版本一致（409）；学生须该科REQUIRED；题号/模板须匹配；已评阅答卷不能替换（409），先核实目标                                                                  |
| review.save / reviews                  | review:{submissionId,itemId,round,expectedVersion,partScores?,score,feedback}                                             | HTTP记录人工评阅，需名单CONFIRMED、该科REQUIRED、阅卷权限与合法轮次/分值；小纸website_request明确禁止此操作；AI必须GRADE                                                                                         |

## 常用嵌套结构

question.content 所有字段：`{stem,options:[{label,text}],answers:string[],explanation,rubric,parts,images:string[]}`。stem非空；options最多26、标签唯一；选择题至少2选项，answers仅有效且不重复标签，SINGLE最多1答案。parts最多100，每个 `{id,type,stem,options,answers,explanation,rubric,knowledgeTags,score}`，type不能MIXED；MIXED必须有parts，其他题型禁止parts。images最多20且为已上传本站资产。保存同时提取题干、选项、答案、解析、rubric及子题中的精确本站私有图片URL，并按同一图片归属权限校验；不能在Markdown中绕过配图授权。校验通过后文字内私有图片引用归入content.images，去重后全部配图最多20张（超出400）；ADMIN按既有权限可引用他人资产，经校验归一化后授权读者可查看。空答案允许保存，不能声称已生成标准答案。

paper.kind=EXAM|HOMEWORK。layout 必需 paperSize=A4|A3、columns=1..4；可选 orientation、fontFamily、textBlocks、marginMm=8..40、fontSizePt=9..24、lineHeight=1..3、showScores、questionLayouts。items最多500：`{questionId,score,section,content?,question?}`。可以从题库引用或提供完整question；每卷questionId唯一。保存后服务器生成 `paper.items[].id`，答题区与答卷引用该itemId，不是questionId。

assessment.papers（1..20，科目与paperId不能重复）：`{paperId,subject,gradingMode:SINGLE|DOUBLE,arbitrationThreshold,questionRules?,conversion}`。conversion=`{enabled,bands:[{upperPercent,min,max}]}`，启用时百分比递增且最后100，分数区间从高到低。questionRules按真实itemId映射 `{doubleReview,arbitrationEnabled,maxDifference}`。

`assessment.roster.update`：`expectedRevision` 为读取到的当前版本；`reason` 为本次变更/确认原因。`addStudentIds` 只能补充本次参与班级内当前存在、且未加入快照的学生，新成员全部科目默认为 REQUIRED。`changes=[{participantId,paperId,status,reason}]` 仅修改已有快照成员的对应科目，逐项原因必填；成员 id 使用 `participants[].id`，不能填 studentId。历史名单确认须 `confirmReconstruction=true`。已发布、版本过期或权限不完整不得修改。发生冲突重新读取并人工核对，不得自动套用新版本重试。已有安排改变班级或试卷集合时，`assessment.save` 要求 `expectedRosterRevision/rosterStudentIds/rosterChangeReason`，明确保存最终学生选择并记录变更；不改变范围时名单保持原样。

submission.status=PENDING|REVIEW|GRADED 表示待评阅、评阅中与已评分；REVIEW 不能据此推断扫描异常。扫描需核对以 alignment 的 needsReview 标记为准：手动扫描按页码字符串保存，AI 导入可能按 sourceFiles 中的原图 URL 保存，也可存在根级标记。

submission.kind=CARD|WORKBOOK；sourceFiles最多100。answers最多500且itemId唯一，每题 `{itemId,text,images,box?,sourcePage?}`，images最多30。box=`{page:1..100,x,y,width,height}`，归一化坐标且区域不能出界。CARD要匹配答题卡，HOMEWORK只用WORKBOOK。

评分记录 `Review.version` 和 `reviewHistory[].version` 为成功写入版本。`review.save.review.expectedVersion` 必填非负整数，0 表示该轮评分尚不存在；修改本人评分时填写已读到的版本。成功返回 `{id,reviewVersion}`；旧版本或条件更新失败返回 409，拒绝操作不新增评分历史、不改当前评分或答卷进度。前端保留冲突草稿，须明确重新读取并选择采用最新版本，不能自动重放旧修改。AI GRADE 只允许不存在的 0 基线，不得读取现有版本后冒充更新人工或旧 AI 评分。小纸工具仍禁止 `review.save`。

review.round=FIRST|SECOND|ARBITRATION，混合题 partScores=`[{partId,score,feedback}]`，必须遵守服务器的评分规则：不能覆盖其他评阅者占用的轮次；单评题只允许 FIRST；双评前两轮须不同教师。ARBITRATION 需要启用仲裁、真人首评和第二评均已存在、分差严格超阈值，并由未参加前两评的第三位教师完成；完成仲裁后不能修改前两评。网站会提前显示不可执行轮次的原因，服务器仍为最终校验依据。此结构只解释HTTP，不解除小纸工具的人工评阅禁用。

card.layout 较大，优先用自动模板接口，若确需自定义请读 describe_api(template.save)：width,height,pageCount、4个markers、studentNumber、regions为必需；regions包含page,x,y,width,height,itemId,kind=CHOICE|BLANK|WRITING及可选选项/书写样式。不能凭空猜测印刷坐标。

源码：`src/server/platform/{schemas,queries,page-state,question-bank,question-stats,scoped-analytics,review-visibility,roster-history,access,service}.ts`、`commands/*.ts`、`src/contracts/{platform,permissions,navigation}.ts`。

`student.save` 的 `userId` 省略、null 与字符串含义不同：省略时保留已有绑定，没有绑定才创建托管学生账号并返回一次性 `credentials`；显式 null 保存未绑定名册，不创建账号也不返回密码，已经绑定账号时传 null 或另一账号 ID 都返回409；字符串只可指定现有学生账号。已有绑定只能省略或原样提交同一账号，不能换人；托管邮箱 @accounts.invalid 不是未绑定凭据，不提供占位账号换绑例外。已有历史但 userId 真为 null 时，仅可在原姓名、卡号、班级均不变且满足既有历史保护时首次补绑定。 新增名册并绑定已有学生账号时，省略 `studentNumber` 优先沿用该账号合法的数字 `username`（1至20位）；该班已有同卡号或同账号时返回409，不静默生成替代号。旧名册补绑定保留原卡号；显式提供的合法卡号也可不同于登录账号。非数字或无 username 的旧账号可使用独立数字卡号。`studentNumber` 是答题身份匹配号，登录使用绑定 User 的 `username`（无 username 时为原账号邮箱），不能把卡号默认当成另一个登录账号。目标不存在或非学生账号返回400，已有教学身份保护冲突返回409。

学生身份和删除保护也包含已持久化课堂名单：有TeachingParticipant引用时不能更改姓名/学号/班级或转绑既有学生账号，不能删除；尚未绑定账号可在身份不变时补绑定本人学生账号。课堂排除保留历史，不通过删除学生消除出勤记录。

线上作业的发放与收交独立于 Assessment.published，专用接口见 [作业收交](homework.md)。普通状态的答卷集合与评分聚合仅含 active 当前轮次；assessment 可有 homeworkCollection:{id,status}。已有线上发放不能用 assessment.save 修改冻结设置或 submission.save/扫描替换学生原稿。旧轮次保留为收交历史，旧答卷 review.save 返回409；名单变更仍需明确核对后同步收交。

`paper.save` 还校验卷首说明与共享阅读块中的真正Markdown私有图片节点；普通教师必须有图片写入归属，ADMIN可合法共享。服务器生成内部阅读图片清单，不接受客户端指定可信清单；授权读取与原题授权相同，每次检查当前题本范围。阅读材料的原题ID／题目项ID锚点在阅卷与学生已发布完整反馈中保留，失效锚材料回到卷首，不静默丢失。详见[材料权限](materials.md)。
