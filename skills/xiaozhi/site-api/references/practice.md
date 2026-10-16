# 自主练习、反馈与练习证据

这是独立练习域，不是正式考试／作业答卷。不会创建或修改 `Assessment`、`ScanSubmission`、`Review`、`ReviewEvent`；题面领取、草稿保存、提交、自评、AI反馈、教师核验不自动改变正式成绩、排名或发布状态。

所有路径前缀为 `/api/platform/practice`，要求有效登录。GET返回JSON并使用 `private, no-store`。POST命令要求本站Origin，JSON上限2 MB；学生图片上传为multipart。小纸 `website_request` 可调用本文目录内GET/POST，但它不会获得比当前用户更多的权限；上传可使用站内附件转换与工具已有文件能力，不能伪造另一人的ownerId。JSON以 `describe_api({operation:"practice.操作名"})` 实时schema为准。

## 查询

| 方法与路径                   | 参数与响应                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/sources`               | query `classroomId? subject? beforeId? paperBeforeId? limit?`，limit默认30、1..100。返回 `actor,sets,replayPapers,publishPapers,ownStudents,canPublish,nextBeforeId,nextPaperBeforeId`。学生只有本人合法来源，教师发布候选不向学生公开。                                                                                                         |
| GET `/sets`                  | 同来源分页与过滤，返回当前身份可读发布列表。学生没有正式成绩报告也可以使用教师已发布练习。                                                                                                                                                                                                                                                       |
| GET `/sets/{id}`             | id为PracticeSet发布ID。返回 `actor,set,studentPaper,fullPaper`；完整Paper仅教师管理视图可读，学生仅题面白名单。                                                                                                                                                                                                                                  |
| GET `/sets/{id}/preview`     | **此id为源Paper ID**。教师预检返回源paper版本、安全studentPaper、每题和卷首可选择／建议题面图、可发布班级及阻止原因。GET不发布、不领取。                                                                                                                                                                                                         |
| GET `/sessions`              | query `studentId? setId? status? beforeId? limit?`，status为DRAFT/SUBMITTED，limit默认30、1..100。返回 `actor,sessions,nextBeforeId`。学生限本人；教师不读学生未提交草稿。                                                                                                                                                                       |
| GET `/sessions/{id}`         | id为PracticeSession ID。返回 `actor,timezone,session,papers,draft,currentAttempt,evaluations,reference,revealedItemIds,eligibility,capabilities`。本人草稿含version/answers/真实updatedAt；教师不能读取当前草稿。学生未明确开放参考时reference为null；授权教师可读完整参考用于核验，不表示参考已向学生开放。安全papers不含答案／解析／评分标准。 |
| GET `/sessions/{id}/history` | query `beforeId? limit? attemptId? evaluationId?`，limit默认20、1..50。指定attemptId定向读取单次提交，可加evaluationId定位评价；不能与beforeId混用。返回 `sessionId,timezone,events,attempts,nextBeforeId`，提交原文与反馈版本保持历史，按当前权限裁剪；定向读取详见下文。                                                                       |
| GET `/reviews`               | 仅教师／管理员；query `classroomId? subject? beforeId? limit?`，limit默认30、1..100。返回 `actor,timezone,attempts,nextBeforeId`，当前班级学科授权的已交尝试，含已核验记录与待核验记录。                                                                                                                                                         |
| GET `/reviews/{id}`          | **此id为PracticeAttempt ID**，不是sessionId。返回 `actor,timezone,session,attempt,papers,answers,reference,evaluations`；教师只读不可变已交快照，不返回学生正在修改的新草稿。                                                                                                                                                                    |
| GET `/evidence`              | query `studentId? subject? beforeId? limit?`，limit默认30、1..100。返回 `actor,timezone,studentId,items,summary,nextBeforeId`；保留对应attempt/evaluationId/version、逐题／子题judgment、知识点、来源、曝光分类与日期。不把自评或AI候选算成人工核验，不赋予“已掌握”百分比。                                                                      |

sources的发布列表使用beforeId／nextBeforeId，自有题本或本人复习卷使用独立paperBeforeId／nextPaperBeforeId；两个集合分别翻页，不能混用游标。GET /sets只翻发布集合。

会话详情、核验列表、核验详情、历史与证据响应另含 `timezone`：作业与练习共用的学校IANA时区（取最近学期，无学期时默认 `Asia/Shanghai`），时间戳本身仍是绝对时间，展示时按该时区渲染，不按设备时区解释。

发布列表按 `(publishedAt,id)`、题本按 `(updatedAt,id)`、会话按 `(createdAt,id)`、证据按 `(recordedAt,id)` 稳定降序，时间相同才按ID排序。教师核验列表按当前不可变提交的 `(submittedAt,id)` 降序，其 `beforeId`／`nextBeforeId` 为 **PracticeAttempt ID**。其余分页游标为对应集合的不透明记录ID，沿本次查询返回的游标继续；不能按UUID大小推断记录新旧。服务器先在当前权限和筛选范围内查验游标，不可读、错误集合或不符合筛选的游标返回404。没有返回的记录不能当作不存在。`capabilities` 和 `blockReasons` 是当前服务器判断，写时仍重验。

## POST `/commands`

共同字段：`type`。版本均为服务端当前正整数，草稿与反馈基线从0开始。UUID必须为真正UUID。学生作答 `answers:[{itemId,text,images}]` 最多500题，text≤100000字符，images最多30张且必须本站资产URL；题目与图片不能重复。图片上传成功后仍须保存草稿。

| type                        | 其余字段与行为                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practice.set.publish`      | `requestId,paperId,classroomId,expectedPaperUpdatedAt,name,studentImageUrls,items:[{itemId,studentImageUrls}]`。仅合法教师题本与当前授权班级学科。requestId为持久UUID；同UUID同原参数返回原发布回执，已关闭也不创建新版；异参数409。完整冻结内容；教师明确选题面图，不默认公开解析图片。name非空≤200；图片数组≤100；items1..500。 |
| `practice.set.close`        | `setId,expectedVersion,reason`。reason非空≤2000；停止新领取并保留已有提交历史。                                                                                                                                                                                                                                                   |
| `practice.start`            | `source,requestId`。source为 `{kind:"SET",setId,expectedVersion,studentId}` 或 `{kind:"REPLAY",paperId,expectedPaperUpdatedAt,studentId}`；studentId为本人ClassroomStudent ID。显式领取、持久会话，requestId用于防重复。REPLAY是已有答案来源，不能冒充未见新题。                                                                  |
| `practice.draft.save`       | `sessionId,expectedVersion,expectedDraftVersion,answers`。只保存本人可编辑草稿，真实updatedAt只随成功保存变化。                                                                                                                                                                                                                   |
| `practice.submit`           | `sessionId,expectedVersion,expectedDraftVersion,requestId`。固定原草稿版本，生成不可变提交；同UUID同基线重试返回原回执，不能吸收新草稿。                                                                                                                                                                                          |
| `practice.retry`            | `sessionId,expectedVersion,copyPreviousAnswers`。开始新一轮草稿，保留旧提交与反馈；同题重做不会增加首次独立题目样本。                                                                                                                                                                                                             |
| `practice.reference.reveal` | `sessionId,expectedVersion,itemIds,reason`，itemIds1..500，reason≤2000可空。明确查看参考；先记录曝光，再返回reference。提交前看参考会影响当前尝试分类，提交后看参考影响以后的尝试。                                                                                                                                               |
| `practice.self-assess`      | `attemptId,expectedEvaluationVersion,evaluation`。本人对已交内容自评；来源SELF，不等于教师核验。                                                                                                                                                                                                                                  |
| `practice.review.request`   | `attemptId,expectedEvaluationVersion,message`，message≤2000可空。申请人工核验或说明异议，不是启动AI。                                                                                                                                                                                                                             |
| `practice.review.confirm`   | `attemptId,expectedEvaluationVersion,candidateId,evaluation,reason`。candidateId可null；仅ADMIN或当前本班本学科任课教师核验，生成新反馈版本，reason非空。更正保留旧反馈，不覆盖历史。                                                                                                                                             |

成功回执为 `{id,version,setId?,sessionId?,attemptId?,sequence?,draftVersion?,evaluationId?,evaluationVersion?,reference?}`，按操作返回实际字段。收到写成功后读取失败，应保留回执并只重新读取；不能因为刷新失败就再发布或再提交。409不能自动用新版本重放本地修改。

`evaluation` 为 `{summary,items:[{itemId,judgment,feedback,parts:[{partId,judgment,feedback}]}]}`。judgment仅 `CORRECT|PARTIAL|INCORRECT|UNSURE|SKIPPED`。题目／小问不能重复；UNSURE和SKIPPED必须说明原因，不能伪装零分或错误。服务会按冻结题目核对逐题与逐小问完整性。反馈来源 `SELF|AI_CANDIDATE|TEACHER_CONFIRMED` 分别显示，不以自评更改正式成绩。

## POST `/sessions/{id}/assets`

学生向本人可编辑会话上传 `file`，单张≤30 MB，整个multipart请求≤32 MB（无Content-Length的流式上传也逐块限额），PNG/JPEG/WebP；图片解码上限5000万像素并归一化PNG，PDF应先转换成分页图片。返回 `{id,url}`。不允许指定他人的session或资产；教师不能借已知UUID读未提交草稿图。上传期间版本或权限变化会拒绝附加，失败资产清理。上传不是保存，更不是提交。

## 自主AI、曝光与证据

AI通过已有 `POST /api/platform/ai`，`kind:"PRACTICE_GRADE"`、`modelId`及 `input:{attemptId,sessionId?,expectedEvaluationVersion,attemptFingerprint,contentFingerprint}` 启动。sessionId由服务器核对，不允许替换作答；指纹为64位小写十六进制。入队只代表已排队；Agent自主读取冻结题目、本人不可变提交与材料，提出反馈或无法判读原因。AI保存候选，不冒充教师核验。

任务详情、列表、SSE的JSON／protobuf及小纸 `wait_for_task` 使用同一安全投影，不把私有参考内容、内部input/result、sandbox代码／stdout发给学生；读取练习详情取得允许公开的反馈。失败可显式重试，固定原输入；人工核验后过期AI不得覆盖新反馈。

曝光分类为 `UNEXPOSED_IN_SYSTEM|REPEAT|ANSWER_AVAILABLE|UNKNOWN`。系统内首次未见答案只说明系统记录，不证明没有外部帮助。旧已发布试卷、复习题本、完整推荐等已经提供答案的入口，即使学生没有展开，也不能算首次未见。保存题目原身份与规范题面指纹，复制ID、更换图片URL或重复重做不产生新的独立样本。正式学习报告与独立练习证据分开展示。

## 权限与错误

学生仅本人当前绑定身份，教师按当前班级与学科授权；草稿正文和附件私有，已提交快照与历史反馈也须每次重验。人工核验和教师发起练习AI还要求ADMIN或该班该学科SUBJECT_TEACHER任课身份；班主任、年级主任或学校管理的阅读权限不自动赋予核验权。学生本人可对自己的有效已交尝试申请AI反馈。已领取内容冻结，源题后续修改不覆盖旧作答。学生身份已有练习记录后不能直接删除、换姓名学号或换绑另一个账号。

401未登录；403角色／Origin不允许；404记录不存在或无权访问（不泄露他人记录）；400参数、材料或评价结构无效；409版本冲突、状态变化、提交幂等基线不符或过期AI；413请求或图片过大；422反馈题目／小问覆盖不全、候选结构或图片来源不合法；429沿已有AI队列限制。返回统一 `{error}`，内部异常不作为可操作业务信息。读取失败与写入失败须分别处理。

## 完整HTTP路径索引

以下完整路径对应上文同名查询和命令，参数、权限及响应遵循上文契约。

### GET /api/platform/practice/sources

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/sets

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/sets/{id}

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/sets/{id}/preview

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/sessions

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/sessions/{id}

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/sessions/{id}/history

登录后按当前身份读取；普通分页见上文查询表。另支持`attemptId? evaluationId?`。`attemptId`指定后只返回本会话该次不可变提交，`events=[]`、`nextBeforeId=null`，不需要沿事件分页寻找旧轮次；不可同时使用`beforeId`。可加`evaluationId`只返回该次提交的指定评价版本，不能脱离attemptId单独传；上述参数组合错误400。

每次读取重新核对当前本人绑定或教师现有班级/学科权限；他人的会话、其他会话的attemptId、缺失提交或不属于该轮的evaluationId均404，不退回当前轮内容。学生仍只得到安全题面、明确已开放的参考与本人原始作答，不读取当前再练草稿，不因定位历史而开放新参考；教师沿当前授权读取已提交内容。响应private/no-store。证据链接使用sessionId、attemptId、evaluationId定位来源，不把最新轮评价当作旧证据。

### GET /api/platform/practice/reviews

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/reviews/{id}

登录后按当前身份读取；详见上文查询表。

### GET /api/platform/practice/evidence

登录后按当前身份读取；详见上文查询表。

### POST /api/platform/practice/commands

本站Origin的写请求；详见上文命令或图片上传。

### POST /api/platform/practice/sessions/{id}/assets

本站Origin的写请求；详见上文命令或图片上传。

AI公共practice.counts仅含CORRECT、PARTIAL、INCORRECT、UNSURE、SKIPPED、total非负整数。普通题按整题计数，综合题按小问计数；这些是反馈条目数，不是正式分数、不同题目数或掌握数。
