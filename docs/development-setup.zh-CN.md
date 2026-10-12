# 本地开发说明

本地运行 Next.js Web、独立 Worker 和 PostgreSQL，用户文件保存到本地磁盘。容器运行与备份见 [部署说明](deployment.zh-CN.md)，模块及权限边界见 [当前工程](framework.zh-CN.md)。

## 依赖

Node.js 版本范围和 pnpm 版本以 [package.json](../package.json) 的 `engines`、`packageManager` 为准，当前使用 Node 24 与 pnpm 11。直接依赖固定版本，完整依赖树由 [pnpm-lock.yaml](../pnpm-lock.yaml) 锁定。

| 依赖                                          | 用途                                       |
| --------------------------------------------- | ------------------------------------------ |
| PostgreSQL 18                                 | Prisma 业务数据与 pg-boss 队列             |
| Poppler 的 `pdfinfo`、`pdftoppm`、`pdftotext` | PDF 信息、页图渲染与辅助文本               |
| 中文字体，如 Noto Sans CJK SC                 | PDF 渲染及测试资料                         |
| Tesseract 与 OSD 数据                         | 照片方向检测；未检出方向时管线使用模型判断 |
| Python 3、SymPy、mpmath                       | 项目 Python 工具环境及依赖检查             |

Sharp 处理图像裁切和缩放，MathJax 渲染公式，shadcn/ui 组件已纳入现有界面。组件初始化配置保存在 [components.json](../components.json)，无需重新初始化。

```bash
pnpm install --frozen-lockfile
```

Prisma CLI、Client 与 PostgreSQL 适配器使用相同版本。生成的 Client 位于 `src/generated/prisma`，由安装后的生成命令创建，不提交 Git。

新环境可创建 Python 虚拟环境并安装固定工具依赖：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip check
```

如果系统缺少 ensurepip，而已有支持 `--python` 的 pip，可使用以下方式引导：

```bash
python3 -m venv --without-pip .venv
pip3 --python .venv install pip
.venv/bin/python -m pip install -r requirements.txt
```

浏览器测试按需要安装专用浏览器；`scripts/env.sh` 将 `PLAYWRIGHT_BROWSERS_PATH` 指向项目 `.local/playwright`：

```bash
source scripts/env.sh
pnpm exec playwright install chromium
```

## 环境变量与数据库

新环境根据 [.env.example](../.env.example) 配置自己的 `.env`。已有环境保留原登录密钥与 AI 凭据加密主密钥；私有配置被 Git 忽略。

| 变量                                              | 用途                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                                    | PostgreSQL 连接串，包含已创建的数据库与用户              |
| `BETTER_AUTH_URL`                                 | 本地通常为 `http://localhost:3000`                       |
| `BETTER_AUTH_SECRET`                              | 至少 32 字符的随机登录密钥                               |
| `PROVIDER_KEY_ENCRYPTION_KEY`                     | 至少 32 字符的随机 AI 凭据加密主密钥                     |
| `STORAGE_ROOT`、`TEMP_ROOT`                       | 默认 `./storage`、`./tmp`，相对项目根目录解析            |
| `PDFINFO_PATH`、`PDFTOPPM_PATH`、`PDFTOTEXT_PATH` | Poppler 可执行文件路径                                   |
| `TESSERACT_PATH`、`TESSERACT_DATA_PATH`           | 可选的方向检测程序与数据路径                             |
| `PYTHON_PATH`                                     | 项目工具环境通常为 `.venv/bin/python`                    |
| `WORKER_CONCURRENCY`                              | 每类队列的本地任务并发，默认 2；模型请求并发另在后台配置 |
| `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`           | 不带 `--configured` 的 CLI 适配器使用                    |

网页模型与六阶段设置在 `/admin/ai` 保存。Web 和 Worker 必须使用同一数据库、存储根目录及凭据加密主密钥。

当前电脑的 PostgreSQL 工具位于 `.tools/postgresql`，数据位于 `.local/postgresql/data`，未注册系统服务。数据库不会随电脑开机自动启动；这两个目录被 Git 忽略，不会随新克隆出现。

已有项目本地数据库时：

```bash
pnpm run db:start
pnpm run db:status
pnpm run db:generate
pnpm run db:deploy
```

`pnpm run db:setup` 合并启动本地数据库、生成 Client 和应用已有迁移，适用于上述目录已准备好的环境。停止本地数据库用 `pnpm run db:stop`。

新电脑先准备 PostgreSQL 并创建应用数据库和用户，再配置 `DATABASE_URL`。使用系统服务或外部数据库时，跳过 `db:start`、`db:setup`，直接运行 `db:generate` 和 `db:deploy`。这些命令不会重置数据库；新增迁移用 `pnpm run db:migrate -- --name <名称>`。

## 启动与检查

```bash
pnpm run dev
```

`dev` 与 `dev:all` 都同时启动 Web 和 Worker。也可在两个终端分别运行 `pnpm run dev:web` 与 `pnpm run dev:worker`。打开 `http://localhost:3000` 创建账号；管理员角色由受控数据库操作授予。

只启动 Web 时页面可访问，但后台 AI 任务需要 Worker。Worker 离线时新任务会收到 `503` 提示，已有任务在处理服务恢复后继续。

```bash
pnpm run doctor
pnpm run check
pnpm run build
```

`doctor` 检查锁定依赖、数据库连接、PDF 工具、字体、Python 和存储。其 PostgreSQL 工具检查指向当前项目的 `.tools/postgresql` 安装；仅使用系统安装的新环境可能在该项失败。项目检查必须带 `run`，`pnpm doctor` 检查包管理器自身。

Web/Worker 集成与真实样例命令见 [集成验证](ai-web-validation.md) 和 [真实样例验证](exam-parsing-validation.md)。仅接受 PDF、JPG/JPEG 和 PNG，Word 请先导出或打印为 PDF。

`check` 顺序执行 Prettier 格式检查、ESLint、TypeScript 和测试。修改格式使用 `pnpm run format`，自动修复 lint 问题使用 `pnpm run lint:fix`；职责划分与依赖约束见 [代码组织与质量检查](code-organization.md)。

## 生产配置

现有 [Dockerfile](../Dockerfile) 和 [compose.yaml](../compose.yaml) 定义 Web、Worker、迁移、PostgreSQL 和 HTTPS 代理。Web/Worker 共享 `/data/storage`，通过宿主机挂载保存原件与产物；数据库保存相对文件 key。开发机的 `.tools`、`.local` 和 `.venv` 不复制进镜像。

容器更新须保留数据库卷、用户文件和密钥，恢复流程同时覆盖这三者。容器构建和联合恢复的验收状态见 [部署说明](deployment.zh-CN.md)。
