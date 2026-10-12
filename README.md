# Oh My Paper

K12 试卷解析、批改与错题练习。已实现工程与账号底座，以及基于真实样本的试卷解析模块：支持 PDF、扫描图和照片，提取题干、选项、子题、材料与题图，分离作答/参考答案，并调用 DeepSeek 独立复核。

登录后在工作台上传试卷，查看后台进度、对照原图核对内容并下载 Markdown / JSON。管理员在 `/admin/ai` 配置多个 AI 提供商、接口类型、base URL、加密密钥、自定义模型和五套系统提示词预设。详细说明与官方提示词/缓存依据见 [AI 配置指南](docs/ai-providers-and-prompts.md)。

识别结果可进入 AI 批改，补充作答、参考答案、评分标准和分值。模型逐评分点给出评语；缺少参考答案时先独立求解与核对，生成的建议经人工确认后计入总分。详见 [批改流程与测试](docs/ai-grading.md)。

新增学生错题本、原题重练、相似题独立核对、手写作答上传，以及班级/学生与批次批改。首页可一次上传自动识别并进入批改；默认启动命令同时运行 Web 和 Worker，避免仅开页面导致任务排队。详见 [学生错题与练习](docs/student-learning.zh-CN.md)。

本次 Web 集成的自动测试、真实 API 用量与浏览器验证记录见[集成验证](docs/ai-web-validation.md)。

配置 `.env` 中的 `DEEPSEEK_API_KEY` 后运行 `pnpm parse:exam "examples/数学_仅试题.pdf"`。结果位于忽略 Git 的 `storage/exam-parses/`。运行 `pnpm eval:exams` 可对六份真实样本进行解析、模型复核与结构检查。完整接口、依赖、输出和限制见 [试卷解析模块](src/server/exams/README.md)。

## 本地启动

使用 Node.js 24、pnpm 11；本地无需 Docker。当前电脑保留已有 `.env`，新环境根据 `.env.example` 配置 PostgreSQL 和随机登录密钥。

```bash
pnpm install --frozen-lockfile
pnpm run db:setup
pnpm run dev:all
```

打开 http://localhost:3000，创建账号后进入个人工作空间。也可分别运行 `pnpm run dev:web` 和 `pnpm run dev:worker`。

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
pnpm run test:exam-web
pnpm run test:learning-web
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
| `src/server/exams` / `src/server/ai` | 试卷标准化、视觉结构化解析、DeepSeek Responses 接入与独立复核 |
| `src/server/grading` | 独立求解、参考答案复核、逐题批改、程序汇总和人工核对 |
| `src/server/pipeline`, `learning` | 快速批改交接、错题投影、练习与班级授权 |
| `worker` | 独立 Worker 进程、环境加载及有限时间内退出 |
| `prisma` | 数据结构与版本化 SQL 迁移 |
| `tools` / `evals` | 待实现的受限工具与评测资料 |

Dockerfile/Compose、联合备份与恢复操作见 [部署说明](docs/deployment.zh-CN.md)；当前环境未进行容器部署验收。

更多说明见 [工程底座说明](docs/framework.zh-CN.md) 和 [实施计划](docs/implementation-plan.zh-CN.md)。
