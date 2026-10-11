# Oh My Paper

K12 试卷解析、批改与错题练习。当前交付工程底座：Next.js App Router、Better Auth、Prisma/PostgreSQL、独立 pg-boss Worker、个人工作空间及服务端授权。试卷和 AI 业务模块暂留边界，等待样本和规则。

## 本地启动

使用 Node.js 24、pnpm 11；本地无需 Docker。当前电脑保留已有 `.env`，新环境根据 `.env.example` 配置 PostgreSQL 和随机登录密钥。

```bash
pnpm install --frozen-lockfile
pnpm run db:setup
pnpm run dev:all
```

打开 http://localhost:3000，创建账号后进入个人工作空间。也可分别运行 `pnpm run dev` 和 `pnpm run dev:worker`。

`db:setup` 使用本仓库已有的 `.tools/postgresql` 安装和 `.local/postgresql/data`；新的电脑需先按 [本地开发说明](docs/development-setup.zh-CN.md) 准备 PostgreSQL。已有其他 PostgreSQL 时配置 `DATABASE_URL`，跳过 `db:start`，分别执行 `db:generate` 和 `db:deploy`。

## 检查

```bash
pnpm run doctor
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
# Web / Worker 已启动后：
pnpm run test:integration
pnpm run test:queue
```

集成检查创建随机测试账号，验证会话、权限和跨工作空间隔离，然后删除这些账号及关联数据。队列检查发送一个基础设施任务，并创建、验证、删除独立的重试测试队列；不会调用模型。

## 工程边界

| 目录 | 职责 |
| --- | --- |
| `src/app` | 页面与 API，受保护的工作空间布局 |
| `src/components` / `src/lib` | 登录表单、退出、Query Provider、浏览器认证客户端 |
| `src/contracts` | 共用 Zod 契约 |
| `src/server/auth` | Better Auth、会话、工作空间及管理员授权 |
| `src/server/db` | Prisma 单例、连接重试、工作空间数据访问 |
| `src/server/jobs` | 入队连接、基础设施任务、消费者及定时任务 |
| `src/server/storage` | Web/Worker 共用存储目录初始化 |
| `src/server/ai`, `pipeline`, `grading`, `curriculum` | 待实现的业务模块 |
| `worker` | 独立 Worker 进程、环境加载及有限时间内退出 |
| `prisma` | 数据结构与版本化 SQL 迁移 |
| `tools` / `evals` | 待实现的受限工具与评测资料 |

更多说明见 [工程底座说明](docs/framework.zh-CN.md) 和 [实施计划](docs/implementation-plan.zh-CN.md)。
