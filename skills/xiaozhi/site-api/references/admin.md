# 系统管理与账号导入

## 管理HTTP

### GET /api/platform/admin

仅ADMIN；响应 `{providers,embedding,searchIndex}`。providers含id/name/apiType/baseURL/maxOutputTokens/transportMode/models（id/name/displayName/reasoningEffort），不返回密钥。embedding包含name/apiType/baseURL/model/dimensions/enabled/version/hasApiKey，未配置为null。searchIndex含total/indexed/pending/failed/enabled/latestFailure对应的可选lastError。

### POST /api/platform/admin

仅ADMIN且同源Origin，JSON默认上限16384字节。所有操作先describe_api(type)，并只在用户请求范围内执行。七个操作：

| type              | 请求除type外字段                                                                               | 返回及约束                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| user.create       | user：STUDENT为 `{role,name,studentNumber?}`；TEACHER/ADMIN为 `{role,username,password,name?}` | 返回创建账号及凭据（以实际响应为准）；学生账号/密码可由系统生成；用户名与密码规则用schema                                     |
| user.role         | `id,role,expectedVersion,reason`；role为ADMIN/TEACHER/STUDENT，reason非空≤2000                 | `{id,permissionsVersion}`；不得降级最后一名ADMIN；角色改变清空旧教学身份，并推进同一权限版本及保存审计                        |
| user.permissions  | `id,assignments,expectedVersion,reason`；assignments最多200，reason非空≤2000                   | `{id,permissionsVersion}`；仅TEACHER，原子替换全部身份，空数组清空；班级/届别须存在，身份不可重复；版本不符409且不写权限/审计 |
| provider.save     | provider                                                                                       | `{id}`；创建需apiKey，更新省略保留旧密钥；模型列表完整替换，省略旧模型会删除该模型                                            |
| provider.delete   | id                                                                                             | `{id}`；删除供应商及其模型，历史任务保留，相关模型偏好置空                                                                    |
| embedding.save    | embedding                                                                                      | `{id:"question-bank"}`；创建需apiKey，更新可省略保留；模型关键配置变动更换索引版本                                            |
| embedding.reindex | 无                                                                                             | `{id:"question-bank",queued}`；需启用embedding，批量排队，返回不代表索引已完成                                                |

assignments每项为 `{role:"SCHOOL_ADMIN"}` 或 `{role:"GRADE_DIRECTOR",stage:"小学|初中|高中",cohort}` 或 `{role:"HOMEROOM",classroomId}` 或 `{role:"SUBJECT_TEACHER",classroomId,subject}`；这里stage示意枚举，实际取一个值；subject需符合系统SUBJECTS枚举。保留用户希望保留的既有身份，不要只发送新增项。

角色与教学身份共用持久 `permissionsVersion`（从0开始），从当前管理员页面状态的目标用户读取；不能固定为0，也不能把旧编辑集合自动套入新版本。两类写入都在事务中重验当前ADMIN，按 `expectedVersion` 比较后推进一次，并保存操作者/目标姓名快照、前后角色/身份、原因与时间。教师改为学生再改回教师仍推进版本，不恢复原身份。409应保留本地修改，显式重读并比较后重新确认；写成功但刷新失败只重读，不能重复写入。历史版本从本迁移后开始记录，不伪造早期历史。

### GET /api/platform/admin/permissions/{id}/history

仅当前ADMIN；id为目标用户ID，其他身份403，目标不存在404。query `beforeId? limit?`，limit默认20、1..100。返回 `{user:{id,name,role,permissionsVersion},events,nextBeforeId}`，events每项 `{id,type,version,actorId,actorName,targetId,targetName,before:{role,assignments},after:{role,assignments},reason,createdAt}`；type为user.permissions、user.role或classroom.save（教师新建班级时自动配置班主任身份，也推进同一权限版本并记录系统业务原因）。只读，不含密码/凭据。JSON `private, no-store`。按 `(createdAt,id)` 降序；beforeId先在同目标范围解析，不存在、其他目标或错误集合游标404。每次读取重验ADMIN；小纸website_request目录允许此GET，读取不授予改权限的授权。

provider：`{id?,name,apiType,baseURL,apiKey?,models,transportMode?,maxOutputTokens?}`；apiType=openai_chat|openai_responses|anthropic|google；HTTP(S) baseURL；models1..30且模型name唯一，每项 `{name,displayName,reasoningEffort?}`；reasoningEffort默认provider-default，可用取值以schema为准。maxOutputTokens=1024..393216默认16384；transportMode默认http，仅openai_responses保留此设置，其他类型强制http。不要在回复复述密钥。

embedding：`{name,apiType:openai|google,baseURL,model,dimensions,apiKey?,enabled?}`；dimensions=1..65536，enabled默认true，baseURL需HTTP(S)且不含用户名/密码。配置/重建是后台向量索引任务，通过GET admin或界面admin/ai-progress核实。

## 账号批量导入HTTP

权限：ADMIN可导入全校学生/教师；TEACHER只可向本人拥有的班级导入学生，必须提供classroomId；学生不能导入。若提供classroomId，只允许role=STUDENT且须可管理班级。以下GET/POST query都必需role=STUDENT|TEACHER；PUT的role/classroomId在body。

### GET /api/platform/accounts/import

query `{role,format?,classroomId?}`，format=csv返回CSV，其他值/缺省返回XLSX模板；二进制下载。website_request返回downloadUrl。学生表头：姓名/学号（或name/studentNumber）；教师：姓名/账号/密码（或name/username/password）。

### POST /api/platform/accounts/import

同源Origin。普通模式：query `role,classroomId?,extension=csv|xlsx`；**原始请求体**为文件二进制，不是multipart。最多2097152字节、500数据行；解析并校验后返回 `{rows,issues:[{row,message}]}`，不创建账号。CSV支持UTF-8，失败尝试GB18030；XLSX取第一个工作表，禁止公式/错误/日期等单元格。小纸只能通过bodyText送CSV（工具上限2000000字符），无法送原始XLSX二进制。

下载凭据模式：query另加 `download=credentials`，JSON `{accounts:[{row,name,username,password}]}`（describe_api(accounts.credentials)）返回XLSX。只生成文件，不创建账号；此POST二进制结果不能经website_request取得，提示用户在 `/admin/users` 保存。不要把凭据传给无关工具或复述到普通报告。

### PUT /api/platform/accounts/import

同源Origin；JSON（describe_api(accounts.import)）：`{role,classroomId?,rows:[{row,name,username,studentNumber,password}]}`；rows1..500，每个row整数>=2，所有字符串字段都要传，非适用字段用空字符串。最大2097152字节。重新校验权限、格式、重复账号等后事务性创建，返回 `{accounts:[{row,name,username,password}]}`。预览issues不为空应先处理，不要把POST预览当作已导入。无通用幂等保证，网络中断先查询用户/名册，避免重复创建。

源码：`src/server/platform/admin.ts`、`search/configuration.ts`、`src/contracts/{auth,account-import,permissions,ai-models}.ts`、`src/server/auth/{accounts,account-import,account-import-file}.ts`。
