# Oh My Paper

K12 试卷解析、批改与错题练习。支持 PDF、扫描图和照片，通过全卷题目识别、逐题精细定位和裁切图文本化保存电子题套；参考答案、学生作答和材料图分别保存。

登录后在试卷板块上传文件，选择是否生成标准答案，查看后台进度、对照原图编辑并下载 HTML / Markdown / JSON。管理员在 `/admin/ai` 配置提供商和五套提示词预设，六个阶段分别选择模型。详见 [试卷流程](docs/paper-workflow.zh-CN.md) 与 [AI 配置指南](docs/ai-providers-and-prompts.md)。

批改要求先补充或生成标准答案。每题的批改 Agent 读取完整作答文档和图像，自行匹配本题答案并逐评分点判分；不明确的作答保留待核对。详见 [批改流程与测试](docs/ai-grading.md)。

批改板块可选择题套上传试卷或答题卡，也可直接上传完整作答卷建立题套后批改。班级批次固定题套版本并复用答案，错题可进入原题重练和相似题练习。功能边界见 [学生错题与练习](docs/student-learning.zh-CN.md)。

自动检查、Web/Worker 测试与浏览器回归记录见 [集成验证](docs/ai-web-validation.md)。

CLI 使用后台阶段配置时运行 `pnpm run parse:exam examples/数学_仅试题.pdf --configured --no-answers`；不带 `--configured` 时使用 `.env` 中的 DeepSeek 配置。产物位于忽略 Git 的 `storage/exam-parses/`。真实请求产生 API 费用，六份样例的结构期望与运行方法见 [真实样例验证](docs/exam-parsing-validation.md)，模块说明见 [试卷解析模块](src/server/exams/README.md)。

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
| `src/components` / `src/lib` | 工作空间界面、题目编辑、报告、认证客户端与共用工具 |
| `src/contracts` | 共用 Zod 契约 |
| `src/server/auth` | Better Auth、会话、工作空间及管理员授权 |
| `src/server/db` | Prisma 单例、连接重试、工作空间数据访问 |
| `src/server/jobs` | 入队、识别/批改/练习消费者、心跳与基础设施定时检查 |
| `src/server/storage` | Web/Worker 共用存储目录初始化 |
| `src/server/exams` / `src/server/ai` | 试卷解析、裁切图 Agent、标准答案、作答文档与多提供商阶段配置 |
| `src/server/grading` | 完整作答匹配、逐题批改、程序汇总、证据报告和人工修分 |
| `src/server/pipeline`, `learning` | 快速批改交接、错题投影、练习与班级授权 |
| `worker` | 独立 Worker 进程、环境加载及有限时间内退出 |
| `prisma` | 数据结构与版本化 SQL 迁移 |
| `tools` / `evals` | 辅助工具目录与真实样例结构标注 |

Dockerfile/Compose、联合备份与恢复操作见 [部署说明](docs/deployment.zh-CN.md)；当前环境未进行容器部署验收。

完整说明见 [文档导航](docs/README.md) 和 [当前工程与运行边界](docs/framework.zh-CN.md)。
