**本地开发依赖与部署环境说明**

日期：2026-10-11。按当前 Windows 开发机检查。此次仅更新计划与依赖说明，没有安装软件、初始化应用或修改全局环境。下面的项目安装/启动步骤需在工程初始化后使用。

本地直接运行 Node.js Web、Node.js Worker 和本机 PostgreSQL；部署服务器使用 Docker Compose。首版所有用户文件保存在本地磁盘，Web 与 Worker 共用文件根目录。PostgreSQL 仍用于业务数据和 pg-boss 任务队列；本地文件存储不替代数据库。

首版仅接收 PDF、JPG/JPEG 和 PNG，适用于试卷、参考答案、作答及快速改卷。Word 文件由用户先导出或打印为 PDF，项目依赖与部署镜像不包含 Word 转换工具。

**已经检测到的依赖与需要补齐的项目**

| 依赖 | 当前检测 | 建议 |
| --- | --- | --- |
| Node.js | 22.23.2，已安装 | 满足 AI SDK 7、pg-boss、Prisma 7 和 PDF.js 的最低版本要求；本地与 Docker 使用 Node 22 主版本 |
| pnpm | 10.11.1，已安装 | 可继续使用，工程 packageManager 固定该版本，部署构建使用相同版本 |
| Git | 当前仓库可用 | 继续使用 |
| Python | 3.13.2，已安装 | 创建项目 .venv；使用已有 Python 3.13，不要求再装其他主版本 |
| PostgreSQL | PATH、常用安装目录和服务未检测到 | 安装 PostgreSQL 18，包括服务器与命令行工具；本地以 Windows 服务运行 |
| Poppler | pdftoppm 26.07.0、pdftotext 25.02.0 可运行，来自不同目录 | 使用独立、完整的一套 Poppler；配置 PDFTOPPM_PATH/PDFTOTEXT_PATH，避免混用版本或依赖 Codex 缓存路径 |
| SymPy | 当前 Python 未检测到 | 在项目虚拟环境安装，用于受限数学校验 |
| OpenCV | 当前 Python 未检测到 | 后续需要透视/倾斜校正时再安装 opencv-python-headless |
| Docker | 本地不需要 | 部署服务器安装 Docker Engine 与 Compose 插件 |

未检测到不等于绝对未安装；已有非默认目录安装时，只需提供路径并验证版本。

PostgreSQL 使用 18 主版本，开发与部署保持一致；官方 Windows 下载页提供 EDB 安装程序。安装时保留服务器、psql 和 pg_dump；pgAdmin 是可选 GUI，StackBuilder 组件无需为本项目另行安装。[PostgreSQL Windows 安装](https://www.postgresql.org/download/windows/)、[PostgreSQL 18 文档](https://www.postgresql.org/docs/18/index.html)

Poppler 至少需要 pdftoppm 和 pdftotext；前者渲染页图，后者提取辅助文本。Windows 可以使用社区维护的完整预编译发行包，它不是 Poppler 项目官方 Windows 安装器。解压到固定工具目录并保留配套 DLL，用明确路径调用；部署镜像由系统包管理器安装对应工具。[Poppler 项目](https://poppler.freedesktop.org/)、[Windows 社区发行包](https://github.com/oschwartz10612/poppler-windows)

PDF 优先使用文件内嵌字体；缺少内嵌字体时，验证中文及数学符号的字体回退。部署 Worker 按样本需要安装可分发字体，并核对 Windows/Linux 渲染结果中的缺字、公式和图形。

**项目 Node.js 依赖**

系统软件需要在电脑安装；下面这些包只在项目中安装，不是全局工具。本次尚未生成 package.json，命令供初始化阶段使用。

| 用途 | 项目依赖 |
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
| 基础开发工具 | typescript、tsx、concurrently、@types/node、@types/react、@types/react-dom、@types/pg、@types/busboy |
| ORM 开发工具 | prisma@7.10.0 |
| 测试 | vitest、@playwright/test |
| 样式和组件 | Tailwind/ESLint 由 Next 初始化器配置；shadcn CLI 按组件添加所需依赖 |

Prisma 三个相关包保持同版本；Prisma 7 的 PostgreSQL 连接采用驱动适配器，因此把 @prisma/adapter-pg 与 pg 一起列为依赖。依赖在实际初始化时再次验证兼容性并锁定到 package.json/lockfile。[Prisma 驱动与连接池](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool)

MathJax 使用当前 4.x 的 mathjax 包；无需沿用旧的 mathjax-full 包名。PDF.js 从项目依赖提供浏览器预览；文件读取由授权 API 完成，不使用第三方公共 URL。[MathJax 本地安装](https://docs.mathjax.org/en/latest/web/hosting.html)

初始化 Next.js 后，基础 React/TypeScript/样式依赖已有；其余包可以按下面分组安装。--save-exact 会把解析得到的确切版本写入项目，最后提交 lockfile。

```powershell
pnpm add --save-exact ai@7 @ai-sdk/openai-compatible @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google zod
pnpm add --save-exact @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg pg-boss better-auth dotenv
pnpm add --save-exact @tanstack/react-query react-hook-form @hookform/resolvers
pnpm add --save-exact sharp busboy file-type pdfjs-dist mathjax@4
pnpm add -D --save-exact prisma@7.10.0 tsx concurrently @types/pg @types/busboy vitest @playwright/test
```

组件开发时通过 shadcn CLI 初始化并按需求添加组件。首次运行浏览器端到端测试时，再下载 Playwright Chromium：

```powershell
pnpm dlx shadcn@latest init
pnpm exec playwright install chromium
```

首版文件读写使用 Node.js 自带 fs/path/crypto，无额外文件存储 SDK。监测类依赖在实现对应功能时加入。

**Python 工具依赖**

先在项目根目录建立虚拟环境，使用环境内 Python 安装 SymPy。下面不依赖 PowerShell 激活脚本：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install "sympy==1.14.0"
```

等图像校正步骤需要 OpenCV 时，再安装：

```powershell
.\.venv\Scripts\python.exe -m pip install opencv-python-headless
```

实际工程会将工具依赖写入 requirements/锁定文件，Docker 使用对应版本。Sharp 已负责常规裁剪缩放，OpenCV 按需增加；无需为此建立 Python Web 服务。[Python 虚拟环境](https://docs.python.org/3.13/library/venv.html)、[SymPy 安装](https://docs.sympy.org/latest/install.html)

**本地配置与启动约定**

安装 PostgreSQL 后创建项目专用数据库与用户。本地默认使用 127.0.0.1:5432，Web 和 Worker 连接同一个数据库。pg-boss 管理自己的队列 schema；业务 schema 由 Prisma 迁移管理。

工程初始化阶段将提供 .env.example；开发 .env 同时用于 Next.js 和显式加载配置的 Worker。环境变量约定如下：

| 变量 | 本地设置/用途 |
| --- | --- |
| DATABASE_URL | 本机 PostgreSQL 连接串，含项目数据库及用户 |
| BETTER_AUTH_URL | http://localhost:3000 |
| BETTER_AUTH_SECRET | 应用登录密钥，生成随机值并妥善保存 |
| PROVIDER_KEY_ENCRYPTION_KEY | 模型供应商凭据加密主密钥，不能提交 Git |
| STORAGE_ROOT | ./storage，统一以项目根目录解析 |
| TEMP_ROOT | ./tmp，任务临时文件与独立处理目录 |
| PDFTOPPM_PATH | 选定 Poppler 发行包中 pdftoppm.exe 的完整路径 |
| PDFTOTEXT_PATH | 同一发行包中 pdftotext.exe 的完整路径 |
| PYTHON_PATH | .venv/Scripts/python.exe，统一以项目根目录解析 |
| WORKER_CONCURRENCY | 首轮设为 2，再按实测调节 |

供应商 API Base URL、API Key 和模型设置通过应用后台录入；不要求把每家模型的密钥硬编码到 .env。以上两个应用密钥仍需环境配置，开发与部署分别生成。

工程会提供下列脚本；目前尚未创建，不能直接在仅有文档的仓库运行：

| 命令 | 用途 |
| --- | --- |
| pnpm dev | 启动 Next.js 开发服务器 |
| pnpm dev:worker | 启动带文件监测的 Worker 开发进程 |
| pnpm dev:all | 同时启动 Web 和 Worker；PostgreSQL 服务先启动 |
| pnpm doctor | 检查数据库、PDF 工具、Python 模块、字体及存储目录权限 |

每个工具先单独验证版本与路径，再运行 doctor。两个进程同时读取项目环境配置，使用同一个 STORAGE_ROOT；跨平台路径使用 Node path 模块处理。

**部署环境依赖与文件持久化**

部署服务器安装 Docker Engine 与 Compose 插件。Node.js、Python、Poppler、所需字体和 npm/Python 包由镜像安装；PostgreSQL 容器使用固定 18.x 版本并配置持久化数据卷。反向代理提供 HTTPS，应用和数据库通信使用内部网络。

首版宿主机 /srv/oh-my-paper/storage 作为文件目录；Web 和 Worker 均挂载到 /data/storage，使用同一 UID/GID 或明确的共享读写权限。容器环境 STORAGE_ROOT=/data/storage，工具路径改为 Linux 路径；临时目录可各容器独立。数据库仅存相对 key，因此不需要把 Windows 绝对路径迁入 Linux。

浏览器上传到 Next.js；文件预览下载由授权接口提供。Worker 读取本地图片字节传给模型，模型供应商不会访问本机路径。用户文件不会进入 public、Git 或镜像。

升级/重建容器保持宿主机文件目录和 PostgreSQL 数据卷。备份覆盖数据库、文件及恢复所需密钥，按批次验证引用一致和恢复可读。部署 Compose 验证在服务器或 CI 完成，本地开发无需 Docker。[Docker 文件挂载](https://docs.docker.com/engine/storage/bind-mounts/)
