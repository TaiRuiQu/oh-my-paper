# Oh My Paper v2 部署指南

本文描述当前 Docker Compose 部署、更新与运行诊断。

生产服务由 PostgreSQL、Web、AI Worker 和 Caddy 组成。v2 的应用镜像发布在 GHCR：`oh-my-paper`、`oh-my-paper-migrate` 和 `oh-my-paper-ai-worker`。三个镜像全部验收、推送成功后，GitHub Actions 才会在 `oh-my-paper` 发布统一入口 `latest`，其中记录三个镜像的固定 digest。服务器定时器每五分钟读取一次入口并更新整组镜像；GitHub Actions 不会替服务器同步 Compose 文件或部署脚本。

服务器需要 Docker Engine、Compose 和 Buildx 插件，以及 Python 3。可用 `docker compose version`、`docker buildx version`、`python3 --version` 检查。

## 全新服务器部署

以下示例使用 Ubuntu、项目目录 `~/oh-my-paper`，并假定当前账号可以使用 `sudo`。所有 Docker 命令都带 `sudo`，避免当前用户不在 `docker` 用户组时失败。

```bash
git clone --branch v2 https://github.com/TaiRuiQu/oh-my-paper.git ~/oh-my-paper
cd ~/oh-my-paper
cp .env.example .env
mkdir -p storage tmp
sudo chown 1000:1000 storage tmp
```

编辑 `.env`，至少设置：

- `APP_DOMAIN`：生产域名。
- `POSTGRES_PASSWORD`：数据库密码。
- `DEPLOY_DATABASE_URL`：容器内数据库连接，主机必须是 `db`。
- `BETTER_AUTH_URL`：生产 HTTPS 地址。
- `BETTER_AUTH_SECRET`：持久认证密钥。
- `PROVIDER_KEY_ENCRYPTION_KEY`：持久提供商密钥加密密钥。
- `QDRANT_API_KEY`：随机向量数据库访问密钥，Compose 内部 Qdrant 与应用共用。
- `APP_VERSION=latest`：跟踪最新完整 v2 发布，也可指定 `sha-<完整 40 位提交 SHA>` 或 release tag。

已有部署必须保留原认证密钥、提供商加密密钥和数据库凭据。私有仓库或私有 GHCR 镜像先登录：

```bash
sudo docker login ghcr.io
```

启动并验证：

```bash
cd ~/oh-my-paper
sudo docker compose -f compose.yaml pull db qdrant proxy
sudo bash deploy/update.sh
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 migrate web ai-worker
curl -fsS https://你的域名/api/health
```

`migrate` 成功退出后，Web 和 AI Worker 才会启动。AI Worker 必须保持运行，否则 AI 任务及题库向量索引会停留在队列中。不要使用 `sudo docker compose down -v`，它会删除数据库、Qdrant 和 Caddy 持久卷。

页面版本标记同时显示源提交的前六位，例如 `v2.0.0 · abc123`，悬停可查看完整提交。发布镜像在构建时由 CI 注入对应 Git SHA，服务器无需安装 Git；切换或回滚镜像时，标记随镜像更新。本地 Next.js 构建自动读取当前提交；从源码构建 Docker 镜像时，在 `.env` 中将 `APP_COMMIT_SHA` 设置为 `git rev-parse HEAD` 的完整输出，或传入同名 Docker build argument。

## 文档导出

作业、试卷和答题卡的 PDF 在用户本机浏览器生成：进入导出页，点击「打印 / 保存 PDF」，在打印窗口选择「另存为 PDF」。打印使用预览中的版面和本机已安装字体；需要新宋体时，在用户电脑安装该字体后刷新预览。服务器与 Docker 镜像不再安装 Chromium，也不打包新宋体。

Word 与答题卡 SVG 仍由服务端生成并经过现有资源权限检查。Word 的最终分页由打开文档的软件与本机字体决定。Poppler 保留在 Web 与 AI Worker 镜像中，用于读取上传的 PDF 扫描件，和 PDF 导出无关。

## 题库向量搜索

当前 Compose 包含 `qdrant/qdrant:v1.19.2`，仅通过内部网络向应用提供 HTTP 服务，不发布 6333/6334 端口。应用使用 `QDRANT_URL=http://qdrant:6333`；本地运行可配置其他 Qdrant 服务。`QDRANT_COLLECTION_PREFIX` 可隔离同一 Qdrant 上的不同部署，必须使用字母、数字、下划线或连字符。

备份应覆盖 PostgreSQL、Qdrant 持久卷和素材目录。

在后台「AI 模型配置」保存独立的向量化模型，支持 OpenAI 兼容 `/embeddings` 或 Google embedding 接口。填写服务实际支持的模型 ID 与输出维度；服务返回维度不一致时明确失败。密钥使用现有 `PROVIDER_KEY_ENCRYPTION_KEY` 加密，不回传明文。

保存配置不会批量调用模型。管理员点击「重建索引」后，AI Worker 才会对存量题逐题向量化，会产生接口费用；之后题目写入由数据库 outbox 自动异步同步。关键词模式在向量服务未配置或不可用时仍可使用。失败任务不自动重复计费，检查后台安全诊断后可手动重建重试；进程中断的索引在五分钟后标记失败。

更换模型、接口或维度会创建独立版本集合，旧向量不参与新模型检索，需手动重建。停用期间仍记录题目变更，重新启用后继续处理。旧版本 Qdrant 集合保留用于人工检查，可在确认切换完成后删除对应旧版本集合；删除当前版本集合后必须重建。若仅恢复了 PostgreSQL 或 Qdrant 一方，也须重建以恢复一致性。后台统计来自 PostgreSQL 的已确认同步记录，Qdrant 存储丢失不会自动变为索引失败。

语义检索先从 PostgreSQL 计算当前账号可用且已同步的候选 ID，再将这些 ID 交给 Qdrant 过滤并按余弦相似度分页，防止待同步修改和删除泄漏旧内容。候选 ID 随题库大小增长；超大规模部署应结合实际负载优化候选过滤。查询仅返回本库题目，未索引题目会显示缺口提示。

`pnpm test:semantic-search` 使用真实 Qdrant 及独立 PostgreSQL schema，向量化接口由本地 HTTP 服务提供，不调用外部付费模型。可通过 `QDRANT_TEST_BINARY` 指定本地 Qdrant 二进制，或直接连接 `QDRANT_URL`；测试集合使用独立前缀并在结束时清理。该测试验证索引与检索机制，不代表外部模型的语义质量。

## Agent Python / shell 沙箱

AI Worker 镜像包含 Bubblewrap、Python、util-linux 和 `tools/sandbox/requirements.txt` 中的图像与科学计算依赖，`PYTHON_SANDBOX_VENV=/opt/python-sandbox`。本地开发需安装相同系统依赖，并在 `.venv` 安装该 requirements；自定义虚拟环境可设置 `PYTHON_SANDBOX_VENV`。

Compose 的 `ai-worker` 需要 `cap_drop: [ALL]`，`no-new-privileges:true`、`seccomp:unconfined`、`apparmor:unconfined`、`systempaths=unconfined`。这些设置使 Bubblewrap 可以建立独立用户/进程/网络命名空间和私有 `/proc`，实际模型代码仍在只读根、禁网和受限工作区内运行。修改 Compose 安全配置后需重新创建 Worker。

Worker 在输出 `platform.ai.worker.started`、连接数据库和领取任务之前执行沙箱启动检查。检查失败会退出并报告部署诊断，避免让模型反复调用必然失败的 Python/shell 工具。CI 中的 `sysctl` 设置只作用于 CI 主机，不会随镜像发布到生产服务器。

```bash
sudo docker compose -f compose.yaml -f compose.release.yaml up -d --force-recreate ai-worker
sudo docker compose -f compose.yaml -f compose.release.yaml exec ai-worker node --conditions=react-server sandbox-check.mjs
```

`sandbox-check.mjs` 是随 Worker 打包的完整隔离验收程序，CI 也会在真实 Docker Worker 中执行；本地可使用 `pnpm test:sandbox`。`pnpm doctor` 会执行包含 user/PID/network namespace、proc/dev 和只读根挂载的沙箱探针。

### 修复所有 Python / shell 命令失败

`bwrap: No permissions to create new namespace` 可能由 Docker 安全配置阻止创建命名空间，也可能由宿主机禁用非特权用户命名空间引起。`write EPIPE` 是沙箱退出后输入管道关闭的伴随错误。仅凭这条日志不能判断是哪一层；新版本会保留 Bubblewrap 的 stderr，避免只看到 EPIPE。

先同步本次 `compose.yaml` 和 `deploy/repair-sandbox.py` 到现有服务器，然后在项目目录执行：

```bash
cd ~/oh-my-paper
sudo python3 deploy/repair-sandbox.py
```

脚本先检查 Compose 是否包含上述必要安全参数；缺少参数时明确报错，不修改宿主机。配置完整后，使用当前发布镜像和 Compose 安全配置运行临时 Worker，执行完整的 `sandbox-check.mjs`，不启动其依赖服务。如果验收通过，直接重新创建现有 Worker，使 Docker 安全参数生效，不改宿主机设置。若验收失败，则读取并修复存在的禁用项：`kernel.unprivileged_userns_clone=0` 改为 `1`，`user.max_user_namespaces=0` 改为 `16384`，`kernel.apparmor_restrict_unprivileged_userns=1` 改为 `0`。这些是宿主机级别的策略，最后一项会关闭宿主机对非特权用户命名空间的 AppArmor 全局限制；已有专用 AppArmor 策略的主机应按自身策略配置。其机制见 [Ubuntu 说明](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)，配额含义见 [Linux 内核文档](https://kernel.org/doc/html/latest/admin-guide/sysctl/user.html)。

只有实际镜像验收通过后，脚本才将变更持久化到 `/etc/sysctl.d/99-oh-my-paper-sandbox.conf`，重新创建 Worker，并在运行中的容器内再次验收。宿主机修复阶段的临时 Worker 验收失败，会回滚本次临时 sysctl 变更，保留运行中的 Worker，不保存失败配置。完成后可在界面点击「重试任务」。脚本使用现有 `compose.release.yaml` 选定的镜像；采用 digest 清单的部署须已执行过 `deploy/update.sh`，生成 `deploy/.release.json`。

手动排查时，核对运行中容器，而不是只查看仓库文件：

```bash
sudo docker inspect oh-my-paper-ai-worker-1 --format 'User={{.Config.User}} SecurityOpt={{json .HostConfig.SecurityOpt}} CapDrop={{json .HostConfig.CapDrop}} MaskedPaths={{json .HostConfig.MaskedPaths}} ReadonlyPaths={{json .HostConfig.ReadonlyPaths}}'
sudo sysctl kernel.unprivileged_userns_clone user.max_user_namespaces
# 仅 Ubuntu 等提供此设置的内核存在下面这项。
sudo sysctl kernel.apparmor_restrict_unprivileged_userns
```

若显示 `Can't mount proc`，核对 `MaskedPaths`、`ReadonlyPaths` 均为空；`systempaths=unconfined` 使用等号。不要给 Worker 开启 `privileged` 或在沙箱失败时直接执行模型代码。

## 配置 v2 定时更新器

定时器以 root 身份运行，必须使用项目的绝对路径；systemd unit 中不要写 `~`。在 `~/oh-my-paper` 执行：

```bash
cd ~/oh-my-paper
PAPER_DEPLOY_DIR="$(pwd -P)"
sudo tee /etc/systemd/system/oh-my-paper-update.service >/dev/null <<EOF_SERVICE
[Unit]
Description=OhMyPaper v2 image update
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
User=root
WorkingDirectory=$PAPER_DEPLOY_DIR
ExecStart=/usr/bin/bash $PAPER_DEPLOY_DIR/deploy/update.sh
TimeoutStartSec=30min
EOF_SERVICE

sudo cp "$PAPER_DEPLOY_DIR/deploy/oh-my-paper-update.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oh-my-paper-update.timer
sudo systemctl start oh-my-paper-update.service
sudo systemctl status oh-my-paper-update.timer --no-pager
sudo systemctl status oh-my-paper-update.service --no-pager
sudo journalctl -u oh-my-paper-update.service -n 100 --no-pager
sudo systemctl list-timers --all oh-my-paper-update.timer
```

oneshot service 成功后显示 `inactive (dead)` 是正常的；应检查 `status=0/SUCCESS`。timer 应显示 `active (waiting)`，并有下一次触发时间。不要 enable service 本身，只 enable timer。

脚本从 Compose 环境（包括 `.env`）读取 `APP_VERSION`；未设置时跟踪 `latest`。它只读取一次发布入口，校验三个 digest 后全部拉取成功，才保存 `deploy/.release.json` 并启动服务。入口不完整、读取失败或任一镜像拉取失败时，保留原运行服务和原本地清单。`compose.release.yaml` 使用这份本地清单，因此第一次启动必须执行更新脚本，之后的手动 Compose 操作也会使用固定 digest。手动更新也要使用 `sudo`：

```bash
cd ~/oh-my-paper
sudo bash deploy/update.sh
```

固定某个已发布镜像进行回滚时，先停用 timer，再编辑 `.env`：

```bash
sudo systemctl disable --now oh-my-paper-update.timer
sed -i '/^APP_VERSION=/d' .env
printf '\nAPP_VERSION=sha-<完整40位提交SHA>\n' >> .env
sudo bash deploy/update.sh
```

恢复自动更新时改回 `APP_VERSION=latest`，手动确认成功后执行：

```bash
sudo systemctl enable --now oh-my-paper-update.timer
```

只拉取应用镜像不会更新服务器上的部署脚本与 Compose 配置；它们有变更时需同步到服务器。构建尚未全部成功时，统一入口保持上次完整发布。

## 日常检查

```bash
sudo systemctl list-timers --all oh-my-paper-update.timer
sudo journalctl -u oh-my-paper-update.service --since today --no-pager
cd ~/oh-my-paper
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 web ai-worker
```
