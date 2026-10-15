# Oh My Paper

面向 K12 教师和学生的试卷处理平台，支持题库、组卷、作业与考试、扫描录入、人工与 AI 阅卷、成绩和学情分析。

## 本地开发

需要 Node.js 24.19+（24.x）、pnpm 11、PostgreSQL 18 和 Python 3.11+。扫描与 Agent 工具还需要系统安装 Poppler、Bubblewrap 和 util-linux；Agent 沙箱在 Linux 上运行。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
python3 -m venv .venv
.venv/bin/pip install -r tools/card-scan/requirements.txt -r tools/sandbox/requirements.txt
```

启动 PostgreSQL 并创建数据库，在 `.env` 中配置：

- `DATABASE_URL`：数据库连接。
- `BETTER_AUTH_URL`：本地使用 `http://localhost:3000`。
- `BETTER_AUTH_SECRET`、`PROVIDER_KEY_ENCRYPTION_KEY`：分别设置至少 32 字符的随机密钥。

```sh
pnpm db:generate
pnpm db:deploy
pnpm dev
```

访问 [本地工作台](http://localhost:3000)。首次启动自动创建管理员，账号和随机密码仅在服务端日志中输出一次；教师和学生账号由管理员分配，教师也可添加学生。

`pnpm dev` 同时启动 Web 和 AI Worker。AI 模型在「系统管理 → AI 模型配置」中配置；语义搜索还需 Qdrant，在 `.env` 中配置 `QDRANT_URL` 和 `QDRANT_API_KEY`，再配置向量化模型并重建索引。

AI 任务列表、详情与向量化索引通过 SSE 实时同步进度。实验性 Protobuf 传输仅用于 AI 进度流：在 `.env` 设置 `AI_PROGRESS_FORMAT=protobuf` 并重启 Web 服务即可启用，无需重新构建前端；默认值为 `json`。Protobuf 消息经 Base64 放入 SSE 的 `data` 字段。首次使用前执行 `pnpm db:deploy` 安装数据库通知触发器。协议及验证方法见 [AI 进度传输](docs/ai-progress.zh-CN.md)。

## 教学权限

管理员在「系统管理 → 账号与权限」中配置教师身份。学校总管理可查看全校数据，年级主任查看本年级，班主任查看本班全科，任课老师查看所任教班级的对应学科。同一教师可兼任多个身份，权限合并生效。学生仅能查看本人已发布的成绩与学习报告。

安排考试时选择「年级联考」或「班级阅卷」：联考由同年级任课老师按学科跨班评阅；班级考试与作业由本班任课老师评阅。所有阅卷老师都可参与双评和仲裁，无需另行指定。

作业、试卷和考试的列表与概览标题旁可直接重命名。导出 PDF 时由本机浏览器打印预览中的版面，在打印窗口选择「另存为 PDF」；字体使用本机已安装字体。Word 和答题卡 SVG 仍可直接下载。

## 开发验证

```sh
pnpm check
pnpm test:integration
pnpm test:permissions
pnpm build
pnpm build:ai-worker
```

数据库专项测试使用独立 schema。运行环境诊断使用 `pnpm doctor`，其他专项测试见 [package.json](package.json)。

## 部署与文档

生产环境使用 Docker Compose 运行数据库、Qdrant、Web、AI Worker 和 Caddy，具体配置与更新步骤见 [部署指南](docs/deployment.zh-CN.md#全新服务器部署)。数据库和 `storage` 目录需一起备份。

- [服务接口与权限契约](src/server/platform/README.md)
- [Agent 工具说明](docs/agent-tools.zh-CN.md)
- [扫描仪接入](scripts/scanner-bridge/README.md)
