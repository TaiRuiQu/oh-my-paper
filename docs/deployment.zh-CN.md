# Oh My Paper v2 部署手册

v2 使用 PostgreSQL、Next.js Web 服务、独立 AI Worker 和本地 Python/OpenCV 扫描程序。旧 Worker / pg-boss 已移除，新的 AI Worker 使用 PostgreSQL AiJob 持久队列。本文对应当前仓库；`docs/releases/v0.1.*` 保留为旧版本档案。

## 配置

复制 `.env.example` 为 `.env`，设置以下项目：

| 配置                          | 用途                                     |
| ----------------------------- | ---------------------------------------- |
| `DATABASE_URL`                | 本地启动和 Prisma 的 PostgreSQL 连接     |
| `BETTER_AUTH_URL`             | 实际网站地址，生产应为 HTTPS             |
| `BETTER_AUTH_SECRET`          | 至少 32 个字符的随机认证密钥             |
| `PROVIDER_KEY_ENCRYPTION_KEY` | AI 提供商密钥的持久加密密钥              |
| `STORAGE_ROOT` / `TEMP_ROOT`  | 原图、逐题截图和临时文件目录             |
| `CARD_SCAN_PYTHON`            | 扫描 Python，默认优先 `.venv/bin/python` |

Docker Compose 还需要 `APP_DOMAIN`、`POSTGRES_PASSWORD` 和 `DEPLOY_DATABASE_URL`；后者必须以 Compose 服务 `db` 为主机名。`POSTGRES_USER` 和 `POSTGRES_DB` 默认分别为 `paper` 和 `oh_my_paper`。已有加密密钥应继续使用，否则原提供商密钥无法解密。

## Docker Compose

```sh
cp .env.example .env
# 编辑 .env 后：
mkdir -p storage tmp
sudo chown 1000:1000 storage tmp
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 migrate web ai-worker
```

部署包含五个服务：

- `db`：固定版本 PostgreSQL，数据保存于 named volume。
- `migrate`：独立 Docker target，使用 Prisma CLI 执行全部迁移；完成后退出。
- `web`：standalone Next.js、Python venv、OpenCV、扫描程序及持久存储挂载，以 uid 1000 运行。
- `ai-worker`：打包的 AI Agent 任务执行器，使用同一数据库、加密密钥与 storage 挂载，持续领取持久化任务。
- `proxy`：Caddy 负责域名、HTTPS 和反向代理，只有代理公开端口。

数据库健康后运行迁移，迁移成功后启动 Web 和 AI Worker，Web 健康后启动代理。`GET /api/health` 检查数据库，作为容器健康检查。Web 镜像中的 `CARD_SCAN_PYTHON` 为 `/opt/card-scan/bin/python`，扫描脚本路径为 `/app/tools/card-scan/scan.py`。

从仓库发布镜像部署：

```sh
docker compose -f compose.yaml -f compose.release.yaml up -d
```

Web 镜像为 `ghcr.io/tairuiqu/oh-my-paper`，迁移镜像为 `ghcr.io/tairuiqu/oh-my-paper-migrate`，AI Worker 为 `ghcr.io/tairuiqu/oh-my-paper-ai-worker`。`.env` 中的 `APP_VERSION` 可固定 v2 release tag；缺省跟踪 `latest`。`deploy/update.sh` 仅拉取这三个应用镜像，数据库和代理版本由运维明确更新。定时器的启用方式仍见 `deploy/oh-my-paper-update.*`。

## 原生部署

安装 Node.js 24.x、pnpm 11、PostgreSQL、Python 3.11+。

```sh
pnpm install --frozen-lockfile
python3 -m venv .venv
.venv/bin/pip install -r tools/card-scan/requirements.txt
pnpm db:generate
pnpm db:deploy
pnpm run doctor
pnpm build
pnpm build:ai-worker
pnpm start
# 在另一个进程运行：
pnpm start:ai-worker
```

使用进程管理器保持 Web 与 AI Worker 运行，以反向代理提供 HTTPS。Web 进程对 `STORAGE_ROOT`、`TEMP_ROOT` 有写权限；扫描子进程使用同一账号及临时目录。打印页面由用户浏览器生成 PDF，不需要在 Web 服务器安装 Chromium。

## 升级与备份

迁移 `20261014010000_full_exam_platform` 删除旧试卷、任务、答题卡批次、积分和旧分析业务表，创建题库、组卷、班级、考试、扫描和评阅模型；保留账号、会话及 AI 提供商配置。`20261014020000_assessment_roster` 保存考试参试名单，旧普通账号归为学生。升级后使用 v2 页面重新建立业务数据，旧 Web 不可连接新数据库。

升级前备份数据库及上传存储：

```sh
bash scripts/backup.sh /absolute/backup-directory
docker compose up -d --build
```

脚本暂停 Web 和 AI Worker 写入，导出 `database.dump` 和 `storage.tar.gz`，生成 `SHA256SUMS`，再恢复 Web 和 AI Worker。备份路径应位于独立持久存储。发布镜像部署应使用 `compose.release.yaml` 更新；旧 Worker 可由 `docker compose up -d --remove-orphans` 清理。

恢复时暂停 Web 和 AI Worker，将 PostgreSQL dump 和存储目录恢复到同一备份点，核对校验和及文件权限，再启动与该数据库版本匹配的 Web 和 AI Worker。恢复旧版数据库时也必须使用旧版应用，不能仅回滚容器镜像。

## 初始化和验证

第一个注册账号为管理员；后续账号默认学生。管理员在工作台「系统管理」授予教师权限。教师创建班级并绑定学生，随后维护题库、组卷、答题卡、考试和阅卷。

```sh
pnpm check
pnpm build
pnpm test:integration
pnpm test:scan
python3 -m unittest discover -s scripts/scanner-bridge -p 'test_*.py'
```

数据库集成测试使用临时独立 schema，不改正式考试。扫描测试使用有真实像素的答题卡与练习册图像。扫描仪接入见 [本机桥接说明](../scripts/scanner-bridge/README.md)；当前缺少真实扫描仪硬件，模拟 eSCL 协议测试不视为硬件验收。

AI 第二阶段已在非 AI 软件流程确认后接入；具体真实模型验收结果见 `v2-docs/acceptance-ai.md`。待验证的扫描硬件不描述为已通过。

## AI 与运行验收

六类 AI 任务为图片试题导入、参考答案／解析／评分标准／知识点补全、按题型与知识点分布组卷、答题卡布局、逐题阅卷及薄弱知识点推题。Agent 自主调用查询、图片检查和结果提交工具；业务提交使用相同权限与数据校验。任务存入 AiJob，Web 轮询事件与状态；Worker 原子领取、限制供应商并发并写心跳，90 秒未更新的任务标为失败。重试必须用户明确操作。

`pnpm test:integration`、`pnpm test:http`、`pnpm test:scan` 验证人工流程、真实 HTTP 与图像持久化；`pnpm test:ai-jobs` 验证真实 PostgreSQL 队列与权限，`pnpm test:ai-domain` 验证 AI 工具持久化，`pnpm test:ai-live` 使用实际配置模型验证六项任务。模拟 runner 和工具响应不能替代真实模型质量验收。当前真实 AI 证据以本轮验收记录为准。

Worker 打包命令 `pnpm build:ai-worker` 生成可独立部署的 `build/ai-worker`，包含 Prisma、AI SDK、Sharp 及追踪依赖。Web standalone 与 Worker 可复制到独立目录验证启动；该验证不能替代 Docker 容器构建与运行。当前环境未安装 Docker，镜像及 Compose 实际部署尚未验收。
