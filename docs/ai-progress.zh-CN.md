# AI 进度传输

任务列表、业务页中的最近任务、独立任务详情与向量化索引进度统一使用 SSE，不再定时请求 JSON 接口。Web 与 AI Worker 之间使用 PostgreSQL `LISTEN/NOTIFY`；新增任务、状态、执行记录、成本和结果提交后，由数据库触发器通知 Web。队列 Worker 领取任务和维护租约的周期不属于进度查询，继续保留。

## 开启实验性 Protobuf

默认使用 JSON。在 `.env` 设置 `AI_PROGRESS_FORMAT=protobuf`，重启 Web 服务即可切换；不需要重建前端，其他接口仍使用 JSON。Docker Compose 的 Web 服务同样从 `.env` 读取此配置，更新后需重新创建 Web 容器。

- `GET /api/platform/ai/events`：本人的最近 100 个任务及公开模型的 `id/name`。
- `GET /api/platform/ai/[id]/events`：本人的指定任务。
- `GET /api/platform/admin/ai-progress`：仅管理员可读取的向量化配置与索引进度，不传递 API 密钥。
- 可用 `?format=json` 或 `?format=protobuf` 覆盖当前连接的默认格式。

两种模式均返回 `text/event-stream`：JSON 的事件名为 `snapshot`；Protobuf 的事件名为 `snapshot-protobuf`，`data` 是 Protobuf 二进制消息的 Base64 编码。SSE 本身使用文本格式，不能直接发送原始二进制。[SSE 标准](https://html.spec.whatwg.org/multipage/server-sent-events.html)

Protobuf 契约为 `src/contracts/ai-progress.proto`。任务状态、标识、时间等使用明确字段；不同任务的输入、结果、成本和执行记录使用 `google.protobuf.Value`，保留嵌套对象、数组、空值、布尔值和数字，不封装 JSON 字符串。修改契约后运行 `pnpm proto:generate` 更新随代码提交的运行时描述文件；单元测试检查两者一致。

## 连接与一致性

Web 每个进程共享一个专用 PostgreSQL 监听连接，最后一个订阅释放后关闭。先建立监听再读取完整快照，随后仅在相关通知到达时查询当前用户的数据。数据库事务提交前不会通知，回滚和单纯租约心跳也不会触发进度查询。[PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html)、[NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)

每次 SSE 连接均发送完整快照，不依赖内存中的事件历史或 `Last-Event-ID` 重放。断线时保留页面上的最近进度，浏览器重新连接后获取当前已提交状态，任务完成后刷新相关业务数据。任务详情收到完成或失败状态后关闭连接；列表持续订阅，以便接收新任务和公开模型变更。手动“刷新状态”会重建 SSE 连接。

每 15 秒发送注释心跳，禁止缓存和代理缓冲；浏览器关闭、取消读取、数据库监听中断、任务详情结束时清理订阅与计时器。慢客户端不会无限积压数据，而会断开并重新获取快照。连接最长保持五分钟，且不超过登录会话有效期，随后重新鉴权。每次读取进度都重新检查用户和任务归属。数据库连接必须支持会话级 `LISTEN`，不能经过事务池模式的连接代理。

## 验证

`pnpm test` 覆盖两种编码、进度推送、断线恢复、事务初始快照竞态、任务隔离及资源清理。`pnpm test:ai-progress` 创建独立数据库 schema，使用真实迁移与独立 PostgreSQL 连接验证提交通知、回滚及心跳静默、JSON／Protobuf SSE、完成关闭和重连快照；CI 会运行这项验收，不调用真实模型。
