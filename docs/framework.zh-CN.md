# 当前工程与运行边界

应用由 Next.js Web 和独立 Worker 组成。Web 提供页面、认证、上传和任务接口；Worker 消费 PostgreSQL 中的 pg-boss 队列，执行试卷解析、批改和练习任务。业务数据由 Prisma 管理，原件与产物保存在共享本地存储。

## 运行入口

`pnpm run dev` 与 `pnpm run dev:all` 同时启动 Web 和 Worker。只启动页面使用 `pnpm run dev:web`，单独启动 Worker 使用 `pnpm run dev:worker`。生产入口为 `pnpm run start` 与 `pnpm run start:worker`。

开发使用默认 Turbopack，生产构建脚本使用 `next build --webpack`。Next.js instrumentation 只记录初始化事件，构建和页面进程不注册队列消费者。

Prisma 使用 `prisma-client` 生成器及 PostgreSQL 驱动适配器，Client 输出到忽略 Git 的 `src/generated/prisma`。已有迁移使用 `pnpm run db:deploy`，新增迁移使用 `pnpm run db:migrate -- --name <名称>`。本地环境准备见 [开发说明](development-setup.zh-CN.md)。

Worker 显式加载环境变量，外部进程变量优先，然后依次读取 `.env.<mode>.local`、`.env.local`（test 模式跳过）、`.env.<mode>`、`.env`。Web 和 Worker 从同一项目根目录运行，使用相同数据库、存储根目录及凭据加密主密钥。

共享服务端模块通过 `server-only` 限制浏览器导入。Worker 和独立集成脚本使用 Node 的 `--conditions=react-server` 条件加载这些模块。

## 认证与权限

邮箱密码注册、登录、退出和持久会话可用，注册密码至少 10 个字符。Better Auth 负责会话、密码哈希、来源校验和基础限流。当前没有邮件验证、密码找回、社交登录或组织邀请流程。

新账号固定为 `USER`，客户端不能写入 `role`。管理员通过受控数据库操作授予 `ADMIN`，`requireAdmin` 每次查询当前数据库角色。登录后首次访问创建个人工作空间和 OWNER 成员，并通过事务与唯一约束避免重复创建。

班级由创建者管理，可添加学生档案并关联已注册学生账号。学生只能读取自己被授权的学习记录，不能修改教师分数。班级与学生的授权在学习模块实现；schema 中的 TEACHING 工作空间类型和成员角色并不代表已提供完整组织邀请功能。

业务 API 在服务端检查会话、归属或成员关系。未登录返回 `401`，无法访问的资源通常返回 `404`，管理员权限不足返回 `403`。原件、裁切图、历史批改证据和下载同样通过授权接口访问。

| 路径 | 职责 |
| --- | --- |
| `/login`、`/register` | 登录与注册 |
| `/dashboard` | 题套上传与试卷列表 |
| `/classes` | 班级、学生与批次 |
| `/exams/:id` | 题套详情与编辑 |
| `/grading` | 选择题套上传作答，或直接上传完整作答卷 |
| `/analysis`、`/wrong-questions` | 学情汇总与错题练习 |
| `/admin/ai` | 提供商与六阶段模型配置 |
| `/api/health` | 数据库就绪检查 |

## 队列与恢复

pg-boss 使用同一 PostgreSQL 的 `pgboss` schema，业务表由 Prisma 迁移管理。Web 的 producer 负责入队；独立 Worker 注册识别、批改、练习和基础设施检查消费者。`framework.ping` 每 15 分钟触发一次，不调用模型。

业务任务记录和队列入队在同一事务中写入。Worker 每十秒更新数据库心跳，45 秒内没有有效心跳时，新任务返回 `503`；已有任务保留。试卷任务有 30 分钟总时限，批改任务有两小时总时限，各模型调用另有独立超时。

产物与状态写入检查 `jobId`、`attempt` 和任务状态，防止旧执行覆盖新任务。解析保存阶段产物和检查点；批改逐题保存结果，恢复时只复用相同提示词版本的评分。pg-boss 重放任务不保证外部模型只调用一次，崩溃窗口可能造成重复请求。

Worker 收到 SIGINT/SIGTERM 后停止领取任务，最多给运行任务 30 秒收尾，35 秒后强制退出。`WORKER_CONCURRENCY` 限制每类队列的本地任务并发，提供商最大并发数限制模型请求，两者分别配置。

## 文件与模块

Worker 启动时验证 `STORAGE_ROOT` 与 `TEMP_ROOT` 可读写。上传校验文件类型、大小和数量；私有文件以相对 key 保存，通过授权接口读取或下载。当前文件接口返回完整文件，没有实现 HTTP Range。Web 和 Worker 必须挂载同一存储根目录。

| 目录 | 职责 |
| --- | --- |
| `src/app`、`src/components` | 页面、API 与界面组件 |
| `src/contracts` | Zod 数据与任务契约 |
| `src/server/auth`、`src/server/db` | 认证、授权及数据库访问 |
| `src/server/ai` | 提供商适配、凭据、阶段设置、Agent 运行及请求调度 |
| `src/server/exams` | 标准化、全卷识别、逐题定位、文本化、参考答案和作答文档 |
| `src/server/grading` | 完整作答匹配、逐题评分、汇总、报告与人工修分 |
| `src/server/jobs`、`src/server/pipeline` | 队列、心跳及自动批改交接 |
| `src/server/learning` | 班级、错题、练习与学生授权 |
| `src/server/storage` | 存储目录初始化 |
| `worker`、`prisma` | 独立执行入口、数据结构与迁移 |

AI 算法边界见 [试卷与批改流程](paper-workflow.zh-CN.md)，容器和联合备份操作见 [部署说明](deployment.zh-CN.md)。
