# 当前电脑依赖检查与安装记录

本文件保留依赖安装时的历史状态。2026-10-11 工程底座已完成，当前 Web/Worker、数据库迁移和认证状态以 [工程底座说明](./framework.zh-CN.md) 为准。

检查日期：2026-10-11。实际环境是 Ubuntu 26.04 LTS / x86_64，直接使用本机已有的 Node.js 24 和 pnpm 11。本文件记录安装前后状态；日常配置、命令与部署约定见 [本地开发说明](./development-setup.zh-CN.md)。

| 依赖 | 检查前 | 当前结果 |
| --- | --- | --- |
| Node.js | 已有 24.19.0 | 使用现有版本 |
| pnpm | 已有 11.21.0 | 使用现有版本；packageManager 固定该版本 |
| Git | 已有 2.53.0 | 无需安装 |
| Python | 已有 3.14.4 | 使用现有 Python 创建项目 .venv |
| PostgreSQL / psql / pg_dump | 未安装 | 已安装 18.6 到 .tools/postgresql |
| Poppler | pdftoppm、pdftotext 均为 26.01.0 | 同一套系统工具，无需安装 |
| 中文字体 | 已有 fonts-noto-cjk | Noto Sans CJK SC 已验证 |
| SymPy / mpmath | 未安装 | .venv 内安装 1.14.0 / 1.3.0 |
| Python 虚拟环境内的 pip | 缺失 | 已补齐 pip 26.2.1 |
| 项目 JavaScript / TypeScript 包 | 没有 package.json 或 node_modules | 已安装 23 个运行依赖、16 个开发依赖 |

全部直接依赖及准确版本见根目录 [package.json](../package.json)，完整依赖树由 [pnpm-lock.yaml](../pnpm-lock.yaml) 锁定。包括 Next.js 16、React 19、AI SDK 7 与四种供应商适配器、Prisma 7.10.0 三个配套包、PostgreSQL 驱动、pg-boss、Better Auth、表单与状态库、Sharp、PDF.js、MathJax、Tailwind、TypeScript、ESLint、Vitest 和 Playwright。

TypeScript 使用 5.9.3、ESLint 使用 9.39.5，以满足现有 Next.js 插件的 peer dependency 要求。ESLint 9 的 npm 元数据已标记不再受支持；后续升级需要同时核对 Next.js 配套插件对 ESLint 10 的支持。React Hook Form 使用 7.89.0，依赖解析保留 pnpm 11 默认的发布满 24 小时限制。pnpm-workspace.yaml 使用 pnpm 11 的 allowBuilds 配置，允许必要依赖完成安装脚本；不再使用 pnpm 10 的 onlyBuiltDependencies。

## PostgreSQL 的安装位置与启动

系统 sudo 需要交互密码，当前会话无法完成该认证。因此已从 Ubuntu 配置的软件源下载 PostgreSQL 18.6、postgresql-client-18 和 libpq5，对照 apt 元数据核验 SHA256，然后解压到项目目录。其余动态库由本机现有系统提供，已验证无缺失。

这是可运行的项目本地安装，未注册为系统服务，也不自动随电脑开机启动。安装文件位于 .tools/postgresql，数据库数据位于 .local/postgresql/data。数据库仅监听 127.0.0.1:5432，TCP 连接使用 SCRAM 密码认证；本地 Unix socket 位于仅当前用户可访问的目录。

已创建数据库 oh_my_paper 和同名非超级用户，连接串及应用随机密钥保存在 .env，文件权限为 600。数据库本地管理员密码单独保存在 .local/postgresql/admin-password。上述文件和数据目录均已加入 Git 忽略规则。

```bash
# 从项目根目录运行
pnpm run db:status
pnpm run db:start
pnpm run db:stop

# 在当前终端使用 psql、pg_dump、项目 Python 等命令
source scripts/env.sh
psql --version
python --version
```

数据库安装完成后已启动。重启电脑后需要手动运行 pnpm run db:start。若将来删除 .tools 或 .local，数据库工具或数据会被删除；它们不随 Git 克隆恢复。

## 已完成的验证

- pnpm install --strict-peer-dependencies 成功，依赖之间无 peer dependency 冲突。
- pnpm run doctor 检查 39 个直接依赖、Node/pnpm 主版本、SymPy 计算、Poppler、中文字体、Sharp、AI SDK 和 PostgreSQL 连接。
- Prisma CLI、TypeScript、ESLint、Vitest 和 Playwright 的版本命令可执行。
- .venv/bin/python -m pip check 未发现 Python 依赖冲突。
- 使用临时 PDF 实测文本提取、页图渲染、Sharp 读取、文件类型识别和 PDF.js 解析；四种模型适配器可以导入。

日常检查运行：

```bash
pnpm run doctor
```

必须带 run：pnpm 11 自带 pnpm doctor 命令，该命令检查包管理器本身，不执行项目脚本。

重新安装项目包：

```bash
pnpm install --frozen-lockfile
.venv/bin/python -m pip install -r requirements.txt
```

本机缺少系统 ensurepip 组件，创建 .venv 时使用 python3 -m venv --without-pip，再用系统 pip3 --python .venv install pip 安装虚拟环境自身的 pip。已有虚拟环境无需重复创建。

## 按规划延后安装的组件

Docker / Compose 仅用于部署服务器；OpenCV 在实现透视或倾斜校正时添加；shadcn CLI 和组件包在实际编写界面时添加。Playwright 库已安装，专用 Chromium 浏览器在首次编写端到端测试时下载；本机已有 Chrome 和 Firefox。

当前仓库仍未实现 Web、Worker、Prisma schema 或数据库迁移，安装依赖并不意味着应用已可启动。pnpm run dev、pnpm run dev:worker 和 pnpm run dev:all 待工程初始化时提供。未来 Docker 镜像使用 Node 24，构建使用 pnpm 11.21.0 和现有锁文件。
