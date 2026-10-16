# 备课与课堂记录

这是独立于考试成绩授权的课堂领域。接口要求登录；目前仅教师与 ADMIN 使用，学生请求403，不返回其他学生名单、教师教案或反思。ADMIN、当前 SCHOOL_ADMIN 可管理；普通教师按已发布课程的实际教师（包括明确代课）授权，不能凭教务任课读取学生考试成绩。所有写请求要求同源 Origin，全部版本与权限以服务端当前记录为准。

### GET /api/platform/teaching/sessions

可选 query `termId,startDate,endDate,status,limit,beforeId`。日期为学校民用日期 YYYY-MM-DD，status=NOT_STARTED|IN_PROGRESS|COMPLETED|INTERRUPTED|CANCELLED；limit默认50，1..100，beforeId为上页最后一条课堂ID，按不可变(createdAt DESC,id DESC)二元游标稳定分页；游标须仍在当前账号权限及同一term/status/实际日期筛选内，否则404，不能跨筛选复用；日期需同时提供且有效范围不超过400天，按实际授课日期筛选（调课不按原日期误归日程）。返回 `TeachingSessions={actor,canManage,sessions,nextBeforeId}`，仅读取已建立课堂，GET 不自动建档。准备新课堂应先读取 `/api/platform/school/schedule` 的已发布课次及 `publicationId`，再调用 teaching.session.prepare。

### GET /api/platform/teaching/sessions/{id}

返回 `TeachingSession`：`id,termId,slotId,originalDate,version,bindingVersion,status,binding,planVersion,confirmedPlanVersion,plan,rosterFingerprint,rosterConfirmed,participants,summary,reflection,startedAt,finishedAt,interruptedAt,currentSchedule,scheduleChanged,canPrepare,canRebind,canCancel,canManageRoster,canTakeAttendance,canStart,canFinish,canCorrect,blockReasons`。

`binding={publicationId,publicationRevision,timezone,lessonIds,lessons}`，lessonIds 为数据库中不可变已发布课次的 ID，lessons 为课表的发布快照；一次连堂课堂包含全部节次。课堂稳定键为 `termId+slotId+originalDate`，调课前取消行与调入课程不重复建课堂。currentSchedule为最新发布安排，可能null。尚未开课的安排变化需要明确重新绑定；同slot改班级或课程不能复用旧课堂，须新建slot建立隔离记录。归档学期的未开始课堂暂停准备与开课。已开始或结束的课堂保留原始安排，不随课表重发覆盖。

`plan={id,version,source:HUMAN|AI,aiJobId,actorName,createdAt,bindingVersion,plan}`，无教案时null。教案结构为：`title,objectives,keyPoints,difficulties,activities,materials,boardPlan,assessmentPlan,notes`。活动含 `id,title,minutes,teacherActions,studentActions,assessment`，最多50项；材料含 `id,title,kind:TEXT|ASSET|QUESTION,content,url?,questionId?`，最多50项。ASSET只能引用获授权的本站图片，QUESTION需当前可读题目，不能编造题库来源。教案每次保存追加不可变版本，保存草稿不会替代教师确认。QUESTION新引用由服务器冻结真实题目快照，精确原样保留的旧材料不因源题修改或删除而被静默替换；修改材料标题可保留原快照，新材料仍按当前题库权限校验。

`participants=[{id,studentId,name,studentNumber,classroomId,classroomName,rosterStatus,rosterReason,attendance,attendanceReason}]`。rosterStatus=EXPECTED|EXCLUDED，排除保留历史；attendance=UNMARKED|PRESENT|LATE|ABSENT|EXCUSED|LEFT_EARLY。默认UNMARKED，不能将未操作视为到场。canStart要求至少一名EXPECTED、名单指纹仍匹配且已确认当前教案，canFinish要求应到成员全部已标记。canManageRoster单独表示合法课堂名单调整权，不因全员排除而关闭恢复入口。能力字段及blockReasons来自服务端；调用方仍须处理写时权限和版本变化。

### GET /api/platform/teaching/sessions/{id}/roster-preview

无query。只读返回 `{sessionId,fingerprint,candidates,addedStudentIds,removedParticipantIds}`；candidates含学生id、姓名、学号、班级快照信息。fingerprint为当前候选名单的64位摘要。确认或调整名单时携带该摘要，当前名册发生变化则409，须重新读取、核对；不能自动接受新名单。确认后名单持久保存，班级之后增减不静默改写课堂记录。

### GET /api/platform/teaching/sessions/{id}/history

query可选 `beforeVersion,limit`（默认20，1..50）。返回 `{sessionId,events,plans,nextBeforeVersion}`；events含 `id,version,type,actorName,createdAt,reason,snapshot`，snapshot为该次课堂快照；plans为当前事件页所引用的不可变教案版本，翻页可读取更早版本。仅当前授权人员可读取，不是公开日志，不向学生或任意同行教师开放。

### POST /api/platform/teaching/commands

JSON上限1000000字节。成功 `{id,version,planVersion?}`；参数无效400、未登录401、角色禁止403、不存在或不可见404、版本或业务前置条件冲突409。409须保留原草稿，明确重新读取核对，不得自动替换版本后重放。以下操作的精确schema通过 `describe_api({operation:"teaching.操作名"})` 获取。

| type                       | 其余字段                                                                                               | 行为                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| teaching.session.prepare   | termId,slotId,originalDate,publicationId                                                               | 从当前已发布课次建立稳定课堂，重复准备同键返回现有课堂；GET不创建        |
| teaching.session.rebind    | sessionId,expectedVersion,publicationId,reason                                                         | 明确接受尚未开始课堂的最新课表安排，保留旧绑定历史                       |
| teaching.plan.save         | sessionId,expectedVersion,expectedPlanVersion,expectedBindingVersion,plan                              | 保存结构化草稿新版本，不确认，不开课                                     |
| teaching.plan.confirm      | sessionId,expectedVersion,planVersion                                                                  | 教师确认明确的当前教案版本                                               |
| teaching.roster.confirm    | sessionId,expectedVersion,fingerprint                                                                  | 对照最新班级名单后建立课堂名单快照                                       |
| teaching.roster.update     | sessionId,expectedVersion,fingerprint,addStudentIds,excludeParticipantIds,restoreParticipantIds,reason | 明确增补、排除或恢复名单成员，保留历史和原因                             |
| teaching.attendance.save   | sessionId,expectedVersion,marks                                                                        | marks为participantId/status/reason数组，至少一项；保存本人授权课堂的出勤 |
| teaching.session.start     | sessionId,expectedVersion                                                                              | 核对有效安排、已确认教案和名单后开始，服务端记录实际时间                 |
| teaching.session.finish    | sessionId,expectedVersion,summary,reflection                                                           | 检查全部应到成员已标记，记录实际进度、总结与反思后完成                   |
| teaching.session.interrupt | sessionId,expectedVersion,reason                                                                       | 保留已完成内容和出勤，记录中断                                           |
| teaching.session.resume    | sessionId,expectedVersion,reason                                                                       | 以明确原因恢复中断课堂                                                   |
| teaching.session.cancel    | sessionId,expectedVersion,reason                                                                       | 取消尚未开始课堂，保留备课记录                                           |
| teaching.session.correct   | sessionId,expectedVersion,reason,summary?,reflection?,marks?                                           | 完成后的明确更正追加版本和审计，不能静默覆写历史                         |

小纸 `website_request` 实际允许以上五个路径对应GET/POST，`describe_api.operations.teachingCommands`提供全部课堂命令。课堂命令不等于考试作答或成绩命令；不能代教师编造点名或授课事实。AI备课任务的候选、版本基线和异步行为见自主AI任务文档；生成完成不等于教师已经确认、开始或完成课堂。
