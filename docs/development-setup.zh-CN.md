# 本地开发依赖与部署环境说明

更新日期：2026-10-11。当前开发机为 Ubuntu 26.04 LTS / x86_64，使用本机已有的 Node.js 24.19.0、pnpm 11.21.0 和 Python 3.14.4。Web、Worker、认证/工作空间 schema 与初始迁移现已初始化；本次范围见 [工程底座说明](./framework.zh-CN.md)。依赖安装历史见 [当前电脑依赖安装记录](./local-dependencies.zh-CN.md)。

本地直接运行 Node.js Web、Node.js Worker 和 PostgreSQL；部署服务器使用 Docker Compose。首版所有用户文件保存在本地磁盘，Web 与 Worker 共用文件根目录。PostgreSQL 用于业务数据和 pg-boss 任务队列；本地文件存储不替代数据库。

首版仅接收 PDF、JPG/JPEG 和 PNG，适用于试卷、参考答案、作答及快速改卷。Word 文件由用户先导出或打印为 PDF，项目依赖与部署镜像不包含 Word 转换工具。

## 本机依赖与版本约定

| 依赖 | 当前状态 | 使用约定 |
| --- | --- | --- |
| Node.js | 已有 24.19.0 | 使用现有 Node 24；部署镜像保持同一主版本 |
| pnpm | 已有 11.21.0 | packageManager 固定该版本；部署构建保持一致 |
| Git | 已有 2.53.0 | 使用现有版本 |
| Python | 已有 3.14.4 | 使用现有 Python，工具依赖安装到项目 .venv |
| PostgreSQL | 已安装 18.6，含 psql、pg_dump | 项目本地安装到 .tools/postgresql，手动管理进程；部署使用 18.x |
| Poppler | pdftoppm、pdftotext 均为 26.01.0 | 使用 /usr/bin 中的同一套系统工具 |
| 中文字体 | 已有 Noto CJK | 已验证 Noto Sans CJK SC 可用 |
| SymPy / mpmath | .venv 中已安装 1.14.0 / 1.3.0 | 版本由 requirements.txt 固定 |
| OpenCV | 尚未安装 | 实现透视/倾斜校正时再添加 opencv-python-headless |
| Docker / Compose | 本地开发不需要 | 部署服务器安装 Docker Engine 与 Compose 插件 |

Node 24 和 pnpm 11 已通过当前依赖兼容性检查，无需安装旧规划中的 Node 22 或 pnpm 10。后续升级以实际兼容性和锁文件为准。

PostgreSQL 由 Ubuntu 软件源的软件包解压安装到项目目录，已核验 SHA256 和动态库依赖。由于系统 sudo 需要交互密码，本次未注册系统服务；数据库不会随电脑开机自动启动。工具位于 .tools/postgresql，数据位于 .local/postgresql/data；它们均被 Git 忽略，新克隆的仓库需要另行准备数据库环境。

Poppler 的 pdftoppm 渲染页图，pdftotext 提取辅助文本。PDF 优先使用内嵌字体；缺少内嵌字体时，按实际试卷样本验证中文、数学符号及图形的回退渲染。部署 Worker 按样本需要安装可分发字体，并核对本地与部署的渲染结果。

## 项目 Node.js 依赖

运行依赖和开发依赖已全部写入 [package.json](../package.json)，当前共 23 个运行依赖、16 个开发依赖；完整依赖树由 [pnpm-lock.yaml](../pnpm-lock.yaml) 锁定。复现安装使用锁文件：

```bash
pnpm install --frozen-lockfile
```

| 用途 | 已安装项目依赖 |
| --- | --- |
| Next.js 基础 | next@16、react@19、react-dom@19 |
| AI 与供应商 | ai@7、@ai-sdk/openai-compatible、@ai-sdk/openai、@ai-sdk/anthropic、@ai-sdk/google |
| 数据校验 | zod |
| 数据库 | @prisma/client@7.10.0、@prisma/adapter-pg@7.10.0、pg |
| 队列与登录 | pg-boss、better-auth |
| 表单与状态 | @tanstack/react-query、react-hook-form、@hookform/resolvers |
| 上传与图像 | busboy、file-type、sharp |
| PDF 与公式 | pdfjs-dist、mathjax@4 |
| Worker 配置 | dotenv |
| 基础开发工具 | typescript、tsx、concurrently、@types/node@24、@types/react、@types/react-dom、@types/pg、@types/busboy |
| ORM 开发工具 | prisma@7.10.0 |
| 测试 | vitest、@playwright/test |
| 样式 | tailwindcss、@tailwindcss/postcss、postcss |
| 代码检查 | eslint、eslint-config-next |

Prisma CLI、Client 和 PostgreSQL 适配器统一为 7.10.0。Prisma 7 的 PostgreSQL 连接采用驱动适配器，配合 pg 使用；schema、迁移及 Client 生成已实现。另新增 server-only@0.0.1 约束服务端模块，当前直接依赖数量以 package.json 和 doctor 输出为准。

TypeScript 5.9.3 和 ESLint 9.39.5 满足现有 Next.js 配套插件的 peer dependency 要求。ESLint 9 的 npm 元数据已标记不再受支持，后续升级须同时核对插件对 ESLint 10 的支持。准确安装版本以 package.json 为准。

[pnpm-workspace.yaml](../pnpm-workspace.yaml) 使用 pnpm 11 的 allowBuilds 配置管理必要安装脚本，并设置 saveExact 和项目缓存目录；.npmrc 仅配置 registry。保留 pnpm 11 默认的依赖发布时间限制。

MathJax 使用 4.x 的 mathjax 包；PDF.js 由项目依赖提供浏览器预览，文件读取由授权 API 完成。首版文件读写使用 Node.js 自带 fs/path/crypto，无额外文件存储 SDK。监测类依赖在实现对应功能时加入。

组件开发时再通过 shadcn CLI 初始化并按需求添加组件；首次编写端到端测试时再下载 Playwright Chromium。下面的命令按需执行：

```bash
pnpm dlx shadcn@latest init
source scripts/env.sh
pnpm exec playwright install chromium
```

scripts/env.sh 将 PLAYWRIGHT_BROWSERS_PATH 设置为项目 .local/playwright；以后运行测试时使用相同设置。本机已有 Chrome 和 Firefox，当前未下载 Playwright 专用浏览器。

## Python 工具依赖

项目 .venv 已创建，含 pip 26.2.1、SymPy 和 mpmath。无需激活虚拟环境即可安装或检查工具依赖：

```bash
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip check
```

若需在当前 Ubuntu 环境重新创建 .venv，本机缺少系统 ensurepip 组件，可以使用现有系统 pip 引导安装：

```bash
# 仅在 .venv 不存在时执行
python3 -m venv --without-pip .venv
pip3 --python .venv install pip
.venv/bin/python -m pip install -r requirements.txt
```

需要图像校正时再添加 OpenCV，并把验证后的确切版本纳入 requirements.txt。Sharp 负责常规裁剪缩放；无需另建 Python Web 服务。部署镜像使用相同工具依赖版本，并验证所选 Python 版本的兼容性。

## 本地配置与可用命令

已创建数据库 oh_my_paper 和同名非超级用户。本地 PostgreSQL 仅监听 127.0.0.1:5432，Web 和 Worker 连接同一个数据库。pg-boss 管理自己的队列 schema；认证与工作空间 schema 由 Prisma 迁移管理。

[.env.example](../.env.example) 已提供；本机 .env 已配置数据库连接串和随机应用密钥，权限为 600，并被 Git 忽略。当前电脑继续使用已有 .env；新环境根据示例生成各自配置，不复用本机密钥。

| 变量 | 本地设置/用途 |
| --- | --- |
| DATABASE_URL | 本机 PostgreSQL 连接串，含项目数据库及用户 |
| BETTER_AUTH_URL | http://localhost:3000 |
| BETTER_AUTH_SECRET | 应用登录密钥，随机生成并妥善保存 |
| PROVIDER_KEY_ENCRYPTION_KEY | 模型供应商凭据加密主密钥，不能提交 Git |
| STORAGE_ROOT | ./storage，统一以项目根目录解析 |
| TEMP_ROOT | ./tmp，任务临时文件与独立处理目录 |
| PDFTOPPM_PATH | /usr/bin/pdftoppm |
| PDFTOTEXT_PATH | /usr/bin/pdftotext |
| PYTHON_PATH | .venv/bin/python，统一以项目根目录解析 |
| WORKER_CONCURRENCY | 首轮设为 2，再按实测调节 |

供应商 API Base URL、API Key 和模型设置将在应用后台录入，不要求把每家模型的密钥硬编码到 .env。开发与部署分别生成应用密钥。

下列命令已可使用：

| 命令 | 用途 |
| --- | --- |
| pnpm run db:start | 启动项目本地 PostgreSQL；重启电脑后手动执行 |
| pnpm run db:stop | 停止项目本地 PostgreSQL |
| pnpm run db:status | 查看数据库进程状态 |
| pnpm run doctor | 检查项目依赖、数据库连接、PDF 工具、Python 模块、中文字体及图像处理 |
| source scripts/env.sh | 将项目数据库工具和虚拟环境加入当前终端 PATH，并设置配套动态库及浏览器目录 |

从项目根目录检查环境：

```bash
pnpm run db:start
pnpm run doctor
```

项目检查命令必须带 run：pnpm 11 自带 pnpm doctor 命令，用于检查包管理器本身。项目 doctor 已验证 39 个直接依赖及主要工具，检查数据库连接前须先启动 PostgreSQL。

以下应用脚本现已可用：

| 命令 | 用途 |
| --- | --- |
| pnpm run dev | 启动 Next.js 开发服务器 |
| pnpm run dev:worker | 启动带文件监测的 Worker 开发进程 |
| pnpm run dev:all | 同时启动 Web 和 Worker；先启动 PostgreSQL |

初始化或更新底座后运行：

```bash
pnpm run db:setup
pnpm run dev:all
```

打开 http://localhost:3000 创建账号。`db:setup` 启动数据库、生成 Prisma Client 并应用已有迁移，不重置数据库。工程沿用现有依赖清单，补齐页面、Worker、配置和数据库迁移。Worker 显式加载与 Web 对应的开发环境变量；两个进程使用同一个 STORAGE_ROOT。跨平台路径使用 Node path 模块处理，后续子进程工具须以 shell:false 和参数数组调用。

## 部署环境依赖与文件持久化

部署服务器安装 Docker Engine 与 Compose 插件。未来 Web/Worker 镜像使用 Node 24，构建使用 pnpm 11.21.0，并根据 pnpm-lock.yaml 安装依赖；Python、Poppler、所需字体和 Python 工具依赖由镜像管理。PostgreSQL 容器使用固定 18.x 版本并配置持久化数据卷。本机已安装的 .tools、.local 和 .venv 不直接复制到镜像。

反向代理提供 HTTPS，应用和数据库通信使用内部网络。首版宿主机 /srv/oh-my-paper/storage 作为文件目录；Web 与 Worker 均挂载到 /data/storage，使用同一 UID/GID 或明确的共享读写权限。容器环境 STORAGE_ROOT=/data/storage；工具路径改为镜像内的 Linux 路径，临时目录可各容器独立。数据库仅存相对文件 key，无需迁移开发机绝对路径。

浏览器上传到 Next.js；文件预览下载由授权接口提供。Worker 读取本地图片字节传给模型，模型供应商不会访问本机路径。用户文件不会进入 public、Git 或镜像。

升级或重建容器保持宿主机文件目录和 PostgreSQL 数据卷。备份覆盖数据库、文件及恢复所需密钥，按批次验证引用一致和恢复可读。部署 Compose 验证在服务器或 CI 完成，本地开发无需 Docker。
