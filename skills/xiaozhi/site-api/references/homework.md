# 线上作业发放与收交

这是学生在线领取、保存草稿、提交、退回重交的接口。原有 `Assessment.kind=HOMEWORK` 保存安排、参试名单和评分规则；只有显式发放后才有 `HomeworkAssignment`。`Assessment.published` 始终表示成绩发布，不表示作业已发放。纸质扫描作业继续使用原扫描入口，已有扫描答卷的安排不能切换为线上收交。

以下六条接口均在小纸 `website_request` 实际目录内。JSON 命令精确 schema 用 `describe_api` 查询 `homework.*`；multipart 用 `files`。所有接口要求登录，每次重新读取当前角色、教学权限及本人学生绑定；普通课表任课或代课不自动扩大成绩授权。学生不能通过这些接口调用教师通用写命令。

### GET /api/platform/homework/assignments

query：`assessmentId?`（原安排ID）、`status?=ISSUED|CLOSED|CANCELLED`、`beforeId?`、`limit=1..100`（默认30）。返回判别字段 `view=TEACHER|STUDENT`、当前 `actor`、`assignments`、`nextBeforeId`。列表按稳定ID倒序分页；学生仅本人任务，教师按班级和学科裁剪。列表不含未提交草稿或整份题目。

摘要包含发放ID `id`、原 `assessmentId`、名称、`version`、收交状态、发放时间、`dueLocal`、转换后的绝对 `dueAt`、学校 `timezone`、`allowLate`、要求、`resultsPublished`、已同步与当前名单版本、`rosterNeedsSync`、能力与阻止原因。教师摘要有 `counts`；学生摘要有本人 `works`。

### GET /api/platform/homework/assignments/{id}/preview

**此路径 `id` 是原 Assessment ID**，用于发放前预检。仅有完整安排管理权限的创建者或管理员可读；学生和无关账号不能通过预览读取题库答案。返回 `assessmentId/name/timezone/rosterRevision/rosterStatus/canIssue/blockReasons/papers`；每份卷含 `id/name/updatedAt/subject/instructions/items`，卷级含说明/共享阅读材料 `textBlocks` 与卷级可见图片选择；每题含教师完整快照、`allowedStudentImageUrls` 与建议的 `suggestedStudentImageUrls`。

预览本身不发放、不改变名单或成绩。教师须明确核对题面图：旧题目的 `content.images` 可能包含答案、解析或评分标准文字中引用的图片，不能整组默认下发。发行命令逐题提供确认后的可见图片，服务端核验属于该题合法资产且覆盖正文内引用；仅隐藏前端答案不构成隔离。

### GET /api/platform/homework/assignments/{id}

这里 `id` 是 **HomeworkAssignment 发放ID**。返回 `HomeworkAssignmentDetail`：

- `view=TEACHER`：`actor/assignment/fullPapers/works/counts`。只含当前授权科目；`works` 不含学生尚未提交的草稿或草稿版本。
- `view=STUDENT`：`actor/assignment/works`。只含本人项，每项有 `draft:{version,answers,updatedAt}`，其中 `answers=[{itemId,text,images}]`；`draft.updatedAt`只代表实际保存草稿时间，教师延期、退回或其他作业项变更不会更新它；未知时间为null，不能用作业项更新时间代替。题目采用独立白名单 DTO，保留整卷说明与仅含id/text/beforeQuestionId的共享阅读材料、卷级图片，以及题型、题干、选项、子题、分值和经确认的题级 `studentImageUrls`，没有标准答案、解析、rubric、题库教师元数据或未选图片。

`work` 对应一个学生×科目快照，包含 `id/participantSubjectId/paperId/version`、历史姓名/学号/班级、参与状态及原因、`collectionStatus=NOT_SUBMITTED|SUBMITTED|RETURNED`、个人实际截止与延期说明、是否逾期、当前提交摘要和各操作能力。提交摘要包括不可变轮次、答卷ID、服务器接收时间、迟交标志、退回时间/原因。能力如 `canSaveDraft/canSubmit/canUpload/canReturn/canExtend` 必须与服务端校验一致，不能靠隐藏按钮替代权限。

教师统计分别给 `required/submitted/notSubmitted/returned/late/exempt/absent/withdrawn`，单位是学生×科目；免交或退出不能记作漏交，漏交不自动记零分或缺考。评分进度仍从既有阅卷记录读取。

### GET /api/platform/homework/assignments/{id}/history

query：`workId?`、`beforeId?`、`limit=1..50`（默认20）。返回 `assignmentId/events/attempts/nextBeforeId`。事件含操作者及名称、时间、类型、原因、服务端裁剪的变化说明；不会直接返回任意审计JSON、未提交草稿或隐藏评分。`attempts` 只返回与本页事件关联且当前账号可读的不可变提交，另有原发放快照的 `paperId/paperName`。每份的 `answers=[{itemId,questionNumber,submitted,text,images}]` 按原卷题目顺序覆盖全部题：`questionNumber` 从1开始，不取提交数组下标；`submitted=false` 表示该轮提交省略此题，text为空、images为空。稀疏或倒序提交均按itemId定位原题，原始文字和图片不重写，不下发题干、标准答案或解析。学生仅本人历史，教师按当前科目裁剪；后来缺考、免考或退出不抹除其已授权历史。原始发放卷缺失时409，不能猜测题号。旧评分保留在数据库，不因收交历史而越过双评隔离或成绩发布。

### POST /api/platform/homework/commands

同源、JSON上限2MB。成功返回 `{id,version,workId?,workVersion?,draftVersion?,attemptId?,sequence?}`；`id` 始终是发放ID。写命令在同一事务和领域锁内读取当前授权及版本；冲突409不得自动重放或覆盖另一页面草稿。

| type                                                     | 必需业务参数与行为                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homework.issue`                                         | `assessmentId,expectedRosterRevision,expectedPapers,instructions,dueLocal,timezone,allowLate`。`expectedPapers=[{paperId,expectedUpdatedAt,studentImageUrls,items:[{itemId,studentImageUrls}]}]`，每份卷和每题完整且不重复。要求已确认名单、至少一名应交者、未来截止、未发布成绩、无现有答卷/发放记录。冻结题目、评分依据与可见图片并建立持久作业项。 |
| `homework.settings`                                      | `assignmentId,expectedVersion,instructions,dueLocal,allowLate,reason`。截止沿已保存学校时区转换；不修改已提交接收时间或历史迟交事实。                                                                                                                                                                                                                 |
| `homework.close` / `homework.reopen` / `homework.cancel` | `assignmentId,expectedVersion,reason`。停止收交保留成绩依据；仅CLOSED可重开。取消不可恢复，原提交与评分保留为历史并退出当前成绩，需另建安排重新发放。                                                                                                                                                                                                 |
| `homework.roster.sync`                                   | `assignmentId,expectedVersion,expectedRosterRevision,reason`。名单先由原名单命令明确增补/退出/恢复再同步；不把后来班级新增者静默加入已发作业。原科目配置不可替换。                                                                                                                                                                                    |
| `homework.draft.save`                                    | 学生本人 `workId,expectedVersion,expectedDraftVersion,answers`，每题文字最多100000字符、图片最多30、全卷最多500题，题目/图片不得重复或引用其他作业项。草稿不会计作已交，教师不能读取内容。                                                                                                                                                            |
| `homework.submit`                                        | 学生本人 `workId,expectedVersion,expectedDraftVersion,expectedAssignmentVersion,expectedRosterRevision,requestId(UUID)`，从服务器已保存草稿创建不可变轮次。必须已发放、名单已确认同步、本人应交且允许在该截止提交。相同请求编号与相同版本基线重试返回原回执；改变基线复用编号409。不接受客户端学生ID、提交时间、分数或任意扫描路径。                  |
| `homework.return`                                        | 管理者 `workId,expectedVersion,expectedAttemptId,reason`，只退回当前已交轮次。原答案、原图和评分不改；旧答卷退出当前成绩，学生重新保存并明确提交才生成下一轮，不继承旧评分。                                                                                                                                                                          |
| `homework.deadline.extend`                               | 管理者 `workId,expectedVersion,dueLocal,reason`，沿作业学校时区；必须晚于当前时间和该生原实际截止。                                                                                                                                                                                                                                                   |

学校民用时间格式 `YYYY-MM-DDTHH:mm`；服务器保存 IANA 时区和绝对时间，不使用设备时区解释。无效日期、夏令时不存在或重复的本地时刻400，须选择明确时刻。服务器按实际接受提交的时间判断截止和 `late`；上传完成不等于已提交。已提交不能修改草稿，教师退回后才可重交；过期且不允许迟交时须联系教师延期。

### POST /api/platform/homework/works/{id}/assets

`id` 为作业项ID。仅当前绑定学生向本人可作答项上传，`multipart/form-data` 字段 `file`；PNG/JPEG/WebP，单图最多30MB，解码像素上限50,000,000；PDF不在此入口转换。返回 `{id,url}`，不保存草稿、不生成提交。上传后再次校验版本、状态和截止，期间失去授权或状态变化则清理文件与资产记录。

图片只可保存到对应项的答案。资产读取仍走 `GET /api/platform/assets/{id}`：学生题面根据发放白名单授权；已交图片按本人或当前授权教师可读；未提交草稿不向教师授权。仅猜测UUID、同班或持有引用不能得到额外访问权。原通用图片上传仍需教师权限。

## 与正式评分及 AI 的关系

每次提交对应独立 `ScanSubmission`，保留 `attemptNumber`；每个学生×安排×科目至多一个 `active=true`。旧轮次保留不可变原稿、Review与ReviewEvent，当前阅卷、成绩、排名、错题与学情只采用有效轮次。退回、取消后不能继续给旧答卷评分。已发放线上作业不能用原扫描/人工 `submission.save` 替换，也不能修改原安排班级、科目和评分设置。

GRADE仍是自主 Agent，读取学生真实文本和全部作答图、题图、参考答案与标准；线上原始作答禁止模型改写或重新裁切。无上传材料的批改在入队事务固定 `submissionIds`，运行时拒绝缺少固定轮次的线上旧任务；退回、重交、出现评分、名单变化或撤权均使旧提交基线失效。教师确认、独立双评及仲裁沿原规则，AI不代学生提交或代教师发布。

成绩已发布时，设置、退回、取消、名单修改等均须先撤回成绩发布。只有当前应交有效答卷全部达到原评分要求才能发布；不能把未交自动记缺考来凑齐。取消的作业或未同步名单不能发布。

常见错误：未登录401；角色/能力不符403或不暴露存在性的404；输入/时区/题目或图片归属不符400/404；旧版本、已提交、截止、停止收交、名单待核、已发布成绩等409；超限413。失败保留本地输入，先重新读取核对；接口没有SSE或后台提交任务，只有另行创建的GRADE使用现有AI队列与事件。
