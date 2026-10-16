# 小纸前端接口、认证与健康检查

本页接口均不在小纸 website_request allowlist。用于解释网站行为、前端开发及能力边界，不应编造小纸可以发PATCH/DELETE、创建新对话或修改自己的内置技能。用户要查看技能时使用list_skills/read_skill/read_skill_resource。

## 对话接口（本人会话与同源写请求）

### GET /api/xiaozhi

响应 `{conversations,models,skills}`。conversations仅本人，按updatedAt降序，字段id/title/modelId/skillIds/updatedAt；models仅id/name（ADMIN可看到全部模型，普通用户仅public）；skills包含内置及个人完整技能。private/no-store。

### POST /api/xiaozhi

创建本人对话，JSON可空或 `{title?,modelId?,skillIds?}`，上限16384字节。title去空白1..100字符；modelId非空最多128；skillIds最多20，每个非空最多128且须存在。模型需可用；响应201完整对话快照（如下）。未给modelId时还不能发起模型任务。设置失败会删除刚创建的空对话。

### GET /api/xiaozhi/{id}

响应快照 `{id,title,modelId,skillIds,updatedAt,status,error,view,pending}`。view含messages/busy/compacting/retrying；messages每项id/role/parts，parts可含text、thinking、image、file（url/name/mediaType）或工具输入输出；用户消息取自原始message.parts，不含模型私有附件清单。pending=`[{id,message,mode}]`为排队/已提交输入。只限本人，即使ADMIN也不跨人访问。

### PATCH /api/xiaozhi/{id}

JSON同创建设置schema（title?/modelId?/skillIds?），默认上限16384字节；返回更新后快照。QUEUED/RUNNING时409，包括只改title也会受此限制；需先停止。skillIds为完整替换，不是新增项列表，modelId只能设有效id，当前schema不接受null清除。

### DELETE /api/xiaozhi/{id}

无body；仅本人，必须workerId为空且不为QUEUED/RUNNING，否则409“请先停止任务”。删除DB对话及对应存储目录，返回 `{id}`。

### POST /api/xiaozhi/{id}/messages

JSON `{message,mode?}`，上限100000字节，mode=steer|followUp（默认followUp）。message：`{id,role:"user",parts}`；id非空最长128；parts1..21个，每项为 `{type:"text",text}`（最多30000字符）或 `{type:"file",url,mediaType,filename?}`（filename最多200）。mediaType为1..200字符的字符串（按附件真实类型传入），url仅本站36字符小写资产id；每消息最多20个文件、至少有非空文本或一个文件。

检查本人对话、已选modelId与附件访问权限；mediaType必须等于所存资产类型，否则400。响应202 `{id:message.id}`，由后台自主Agent处理，不代表已生成回复。相同message.id已属于同对话时返回原id，提供消息级去重；属于其他对话则409。停止中409；每对话最多20个等待输入，否则429。steer意图是调整正在执行的工作，followUp是后续请求；实际忙闲与排队以快照为准。

### POST /api/xiaozhi/{id}/stop

无body；仅本人。若QUEUED/RUNNING则设置cancelRequested，返回 `{id}`；这是**请求停止**，不保证响应时worker已退出。观察快照直到空闲再删除或改设置。对已结束会话是无操作成功。

### GET /api/xiaozhi/{id}/events

本人对话SSE；Content-Type:text/event-stream。`event:snapshot` data为完整对话快照；retry1500毫秒，heartbeat注释每15秒；最多5分钟或会话到期关闭，连接已取消可204。重连后获取最新快照，不承诺按Last-Event-ID恢复增量；连接关闭不代表模型任务完成。小纸自身不能用website_request订阅。

### POST /api/xiaozhi/attachments

同源multipart `file`；任一有效角色均可上传自己的对话附件（与仅教师的platform/materials不同）。保留原始字节，不预转页或压缩；空文件400，每文件最多30000000字节，Content-Length超32000000提前413。响应 `{id,url,name,mediaType,size}`，没有pages/pageCount。mediaType按扩展名映射PDF/PNG/JPEG/WebP/TXT/CSV/JSON，未知为application/octet-stream，不能把扩展名类型当作已验证文件内容。将返回url/mediaType/name传入message文件part；worker把真实资产挂载到只读沙箱，模型自行决定读取、渲染与处理。

## 个人技能接口

### POST /api/xiaozhi/skills

本人同源JSON `{name,description,instructions}`，上限100000字节。name去空白1..60，description1..300，instructions1..20000；每人最多100个，超出429。响应201 `{id,name}`。是个人DB技能，不写入内置目录。

### PUT /api/xiaozhi/skills/{id}

本人同源JSON与创建相同，完整替换三个字段；上限100000字节。响应 `{saved:true}`，非本人或不存在404。不能更新内置skill；该路径没有GET，请从GET /api/xiaozhi的skills列表读取。

### DELETE /api/xiaozhi/skills/{id}

本人同源，无body，删除个人技能并在本人全部对话的skillIds中移除该id；响应 `{deleted:true}`。非本人/不存在/内置id均404。没有单独列举skills的HTTP GET route（GET /api/xiaozhi返回skills，工具list_skills直接读取）。

## 基础接口

### GET /api/health

无需登录；数据库SELECT 1成功200 `{status:"ok",version:"2.0.0"}`，失败503 `{status:"unavailable"}`。version为此路由固定字符串，不能据此推断package.json版本一致。

### GET /api/auth/{...all}

### POST /api/auth/{...all}

捕获后续多段路径，整体委托当前安装Better Auth的toNextJsHandler；并非每条子路径都同时支持GET/POST。用户创建与教学角色管理走站内管理API，不走公开注册。当前配置启用emailAndPassword与username插件、禁用sign-up、会话有效7天/每天刷新、rateLimit开启、trustedOrigins仅本站配置origin。Better Auth会执行自身认证/来源/输入校验并返回自身成功/错误格式；包装层捕获异常才走共同errorResponse。

应用实际使用：`POST /api/auth/sign-in/username`（账号/学号登录，JSON username/password等由安装版schema定义）、`POST /api/auth/sign-out`（退出）、`GET /api/auth/get-session`（会话）。这些都是catch-all下的库路由，没有独立route.ts，不应把对外暴露范围误说成只有这三项。全部32条已注册子路由与分片schema见[认证索引](auth.md)。其它库端点按**当前安装版本与启用插件**的schema判定；不要假定未配置的OAuth、验证码或注册能力可用。此参考覆盖本站显式路由与应用使用的认证接口，库内部端点的精确输入输出应查安装包，不作为小纸额外工具能力。

源码：`src/app/api/{xiaozhi,auth,health}/`、`src/contracts/xiaozhi.ts`、`src/server/xiaozhi/{store,events,skills}.ts`、`src/server/auth/index.ts`；登录/退出实际调用在前端认证组件中。
