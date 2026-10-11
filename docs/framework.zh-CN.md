# 工程底座

本次完成实施计划阶段 1 的工程与账号底座。供应商后台、AI、文件上传、评分及学生业务数据结构仍待实现。没有添加试题样本、模拟评分或模型调用。

## 运行入口

Next.js 负责页面、认证接口和服务端权限校验。Worker 独立运行，共享 Prisma、队列与存储模块。Next.js instrumentation 只记录初始化事件，不连接数据库、不启动消费者；生产构建不执行任务。

开发服务器使用默认 Turbopack；生产构建脚本使用 Next.js 内置的 Webpack。当前环境中 Turbopack 生产构建的 CSS helper 无法绑定本地端口，Webpack 构建可用。

`pnpm run dev:all` 同时运行 Web 与 Worker，任一进程退出时停止另一进程。先使用 `pnpm run db:setup` 启动现有本地数据库、生成 Client、应用迁移。新增迁移用 `pnpm run db:migrate -- --name <名称>`；部署已有迁移用 `pnpm run db:deploy`，不执行 db push 或重置数据库。

Prisma 使用 7.x 的 `prisma-client` 生成器和 PostgreSQL 驱动适配器，生成目录为 `src/generated/prisma`，不提交 Git。数据库连接懒加载并在进程内复用；初始连接具备有限重试，连接与查询设置超时。Web 就绪检查 `/api/health` 验证认证表可查询，失败返回 503，不返回底层连接错误。

Worker 通过 dotenv 显式加载环境，顺序与 Next.js 一致：外部进程变量优先，然后 `.env.<mode>.local`、`.env.local`（test 模式跳过）、`.env.<mode>`、`.env`。从项目根目录启动进程，确保两个进程的相对文件路径一致。

`pnpm run start` 运行已构建的 Web；`pnpm run start:worker` 显式使用 production 模式，保证两个生产入口加载对应的生产配置。

共享服务端模块使用 `server-only` 防止浏览器导入。独立 Worker 和集成检查通过 Node 的 `--conditions=react-server` 条件导入这些模块，不依赖 Next.js 请求上下文。

## 认证与权限

邮箱/密码注册、登录、退出和持久化会话已经可用，注册密码至少 10 个字符。Better Auth 负责密码哈希、Cookie、来源校验和基础请求限流。当前不提供邮件验证、密码找回、社交登录或组织邀请；接入邮件服务后再添加相应流程。内存限流是单进程基础保护，多副本部署时需补充共享限流。

新账号角色固定为 `USER`。`role` 禁止客户端写入，没有默认管理员或硬编码账号；管理员需要通过受控数据库操作授予 `ADMIN`。`requireAdmin` 每次读取当前数据库角色，以便角色撤销立即生效。

登录后首次访问工作台或 `/api/me` 时，以数据库事务和唯一约束创建个人工作空间及 OWNER 成员。并发创建触发唯一约束时重试完整事务，重复访问不会重复创建空间。schema 保留 TEACHING 工作空间类型和 OWNER/TEACHER/STUDENT 成员角色；教师空间创建、邀请、学生档案绑定还未实现。

`requireWorkspaceAccess` 按当前会话用户和成员关系检查访问，可再限制允许的成员角色。无会话返回 401，不可访问的空间返回 404，角色不足返回 403。业务 API 接入时必须复用这些服务端检查。

| 路径 | 当前行为 |
| --- | --- |
| `/login`、`/register` | 认证表单；已登录用户跳转工作台 |
| `/dashboard` | 服务端保护的个人工作空间 |
| `/api/auth/*` | Better Auth 登录、注册、会话及退出接口 |
| `/api/me` | 当前用户与被授权的工作空间 |
| `/api/workspaces/:workspaceId` | 按成员权限返回指定工作空间 |
| `/api/admin/status` | 验证管理员授权底座 |
| `/api/health` | 数据库和认证表就绪检查 |

## 队列与文件

pg-boss 使用同一 PostgreSQL 的 `pgboss` schema，业务表由 Prisma 迁移管理，队列表由 pg-boss 初始化管理。Web 使用的 producer 不启动调度器或维护器；只有独立 Worker 注册消费者与 Cron。

`framework.ping` 是唯一已注册任务，具备有限重试和执行超时，每 15 分钟触发一次基础设施检查。任务只校验载荷、记录任务 ID，并由队列保存完成状态。业务幂等写入与检查点在 pipeline 模块实现时定义，ping 不声称实现业务恢复保证。Worker 收到 SIGINT/SIGTERM 后停止领取任务，最多给运行中任务 30 秒收尾，35 秒后强制退出。队列持久性与失败重试可通过 `test:queue` 验证。

Worker 启动时创建并验证 STORAGE_ROOT/TEMP_ROOT 可读写。文件上传、授权下载、Range、路径校验及孤儿文件清理尚未开放。用户文件保存在忽略目录，不能放在 public。

## 当前范围与下一步

依赖沿用已有版本，只新增 `server-only@0.0.1`。当前不需要试题数据即可验证注册/登录、数据库、权限和基础队列；数据集准备好后再细化业务 schema、供应商配置与评测契约。

生产部署 Dockerfile/Compose 在供应商和文件基础流程完成后按实施计划准备，本次未配置生产服务或发布网站。

框架接口与数据库配置参考 [Better Auth Next.js 集成](https://better-auth.com/docs/integrations/next)、[Better Auth Prisma 适配](https://better-auth.com/docs/adapters/prisma) 和 [Prisma Client 生成](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client)。
