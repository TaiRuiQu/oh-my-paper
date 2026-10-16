# 学年学期、课程与课表

这些接口是单校教务领域，不扩大考试、学生成绩或题库的权限。全部要求登录，写请求要求同源 Origin。ADMIN 或拥有当前 SCHOOL_ADMIN 身份的教师可管理；其他教师只读取本人已发布课程，学生只读取所属班级的已发布课程。学期开课的教师关系独立于既有成绩授权，不会自动获得考试阅卷权限。

### GET /api/platform/school/state

无 query。返回 `SchoolState={actor,canManage,years,terms,courses,rooms,offerings,classrooms,teachers,publications}`。管理者读取目录和草稿；非管理者不接收全校教师/班级/开课目录或课表草稿。`canManage` 为服务端当前身份判断，不能仅按前端角色或任课记录推断。

`years=[{id,version,name,startDate,endDate}]`；`courses=[{id,version,name,subject,active}]`（自定义课程名称，subject 为可选题库学科关联，null 表示无关联）；`rooms=[{id,version,name,capacity,active}]`。学生及普通教师不能修改这些目录。

`terms=[{id,yearId,name,startDate,endDate,weekOneMonday,timezone,archived,revision,publishedRevision,publishedAt,timetable?}]`。日期为学校民用日期 `YYYY-MM-DD`，时间为 `HH:mm`；学校时区使用 IANA 标识。学期位于学年范围内；教学第 1 周周一须覆盖学期开学日。同校学期采用统一时区，避免跨学期资源重叠判定歧义。发布后名称、课次和时区按发布快照读取，不受尚未发布的编辑影响。

`offerings=[{id,termId,courseId,classroomId,teacherId,weeklyPeriods,active}]`：学期中某班某课程的任课与周课时。`publications=[{id,termId,revision,createdAt,actorName,reason,lessonCount}]` 为出版历史，不含未授权的学生信息。

### POST /api/platform/school/commands

JSON 上限 1000000 字节。仅教务管理者。`type` 选择下列命令，具体精确输入通过 `describe_api` 读取相同操作名；成功 `{id,revision?,version?}`。不存在或不可见 404；无教务写权限 403；版本过期、归档/发布约束或资源冲突 409；格式/日期/关联无效 400。发生冲突须重新读取并核对，不能给旧草稿自动套新版本重试。

| type                     | 其余字段                                                                                     | 行为                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| school.year.save         | `year:{id?,expectedVersion?,name,startDate,endDate}`                                         | 新建或按版本修改学年，不能让已有学期越出边界                                                     |
| school.term.save         | `term:{id?,expectedRevision?,yearId,name,startDate,endDate,weekOneMonday,timezone,archived}` | 学期与档案状态；已有学期修改需原 revision；已发布学期不能更换所属学年（400），保留已发布档案归属 |
| school.course.save       | `course:{id?,expectedVersion?,name,subject,active}`                                          | 新建或修改课程；停用保留历史引用                                                                 |
| school.room.save         | `room:{id?,expectedVersion?,name,capacity,active}`                                           | 新建或修改教室；capacity 正整数或 null，停用保留历史                                             |
| school.offering.save     | `termId,expectedRevision,offering:{id?,courseId,classroomId,teacherId,weeklyPeriods,active}` | 选择当前存在教师、班级和启用课程；更新学期 revision                                              |
| school.timetable.save    | `termId,expectedRevision,reason,timetable`                                                   | 完整保存结构化草稿，更新 revision；不自动发布                                                    |
| school.timetable.publish | `termId,expectedRevision,reason`                                                             | 在事务内核对当前授权、配置和资源冲突，再保存不可变实际课次和出版历史                             |

`timetable={periods,slots,calendar,overrides}`，四个集合均必填。节次/课表/调课 id 须稳定且各自唯一；更新时保留原 id，新增时使用新 id。

- `periods=[{id,name,startTime,endTime}]`：起时早于止时，最多 30 节。
- `slots=[{id,offeringId,weekday,periodIds,roomId,fromWeek,toWeek,parity}]`：weekday=1..7（周一至周日），教学周 1..54，parity=ALL|ODD|EVEN，连续多节用有序 periodIds（1..12，不重复），roomId 可 null；最多 1000 条。时间重叠按实际起止段验证，不能只比较节次 ID。
- `calendar=[{date,kind,sourceDate,reason}]`：kind=CLOSED 时 sourceDate=null，表示当天停课；kind=REPLACE 时 sourceDate 为要采用的另一教学日期，表示按该日期的常规周课表上课。来源不递归套用校历，避免循环。每个实际日期一项，最多 400 项，原因必填。
- `overrides=[{id,slotId,originalDate,action,date,periodIds,teacherId,roomId,reason}]`：调整已展开的实际课次。action=CANCEL 时 date=null、periodIds=[]；MOVE 时填写新日期与节次，可指定代课教师/教室。CLOSED 日不接受调入，原因必填；同一 slotId+originalDate 不能重复，最多 1000 项。

草稿中的无效引用、重复/缺失节次、越界日期、资源冲突须先修正；周课时不足或超出有明确告警，不代表实际配置已满足教学计划。发布版本与草稿 revision 分开显示，未发布改动不能出现在师生的今日课程中。历史引用受数据库保护，不应删除目录或人员来消除历史课程。

### GET /api/platform/school/timetable/check

query 必填 `termId`；仅管理者。展开已保存草稿，返回 `{revision,lessons,conflicts,warnings}`。不保存也不发布。`conflicts=[{kind:TEACHER|CLASSROOM|ROOM|CONFIGURATION,date,lessonIds,message}]`，date 可 null；message 以编辑器位置「周课表 N」「调代课 N」加班级·课程·教师名称定位条目，不返回内部 UUID。`warnings=[{kind:WEEK_CLOSED|SHORTFALL,week,message}]`：SHORTFALL 是该周存在教学日时某开课任务的常规课时数与计划不符（校历例外和调课另计，首末周可能不完整）；WEEK_CLOSED 是该周全部教学日停课时，把该周预期缺口合并成的单条校历说明（由停课解释，不是漏排）。不能把检查通过当作稍后发布必定成功，发布事务会再次验证。

### GET /api/platform/school/schedule

query 必填 `termId,startDate,endDate`，起日不晚于止日；学校日期而非浏览器或服务器时区时间戳。返回 `{termId,publicationId,revision,timezone,startDate,endDate,lessons,status:UNPUBLISHED|PUBLISHED}`（publicationId为当前发布ID，未发布null，用于建立课堂的发布基线），仅读取最近已发布版本，不含草稿。未发布时 revision=null、lessons=[]，不得误称当天无课；PUBLISHED 且指定日期无记录才表示该范围无课。

`lessons=[{id,termId,offeringId,slotId,date,originalDate,startTime,endTime,periodNames,courseId,courseName,classroomId,classroomName,teacherId,teacherName,roomId,roomName,status,reason}]`。status=SCHEDULED|CANCELLED；取消/调课原因要保留，不能把取消项当成应上的课。teacher/classroom/course/room 名称来自发布时快照。普通教师只收到本人课次；学生只收到本人班级的已发布课次，不接收其他学生名单。

小纸 `website_request` 实际允许这四个路径的对应 GET/POST，`describe_api` 同步提供七个命令 schema。小纸可在用户授权范围内自主查询、准备教务草稿和解释冲突；发布必须在用户请求范围内。此能力不等于已有自动排课专用 AI 任务、学生在线交作业；课堂与备课另见teaching接口。
