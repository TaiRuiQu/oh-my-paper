# Ubuntu：从 0.1.15 切换到最新 v2

适用于已经在 Ubuntu 上部署过 0.1.15、项目目录为 `~/oh-my-paper`，并已配置旧版 `oh-my-paper-update.timer` 的服务器。本文只处理应用镜像和定时器切换；不需要处理旧数据或数据库迁移。

所有 Docker 和 Compose 命令都使用 `sudo`。请在原部署账号的 Bash 会话中执行，不要先执行 `sudo -i`，否则 `~` 会变成 `/root`。

## 1. 停止旧定时器

```bash
cd ~/oh-my-paper
sudo systemctl disable --now oh-my-paper-update.timer
sudo systemctl stop oh-my-paper-update.service || true
sudo systemctl list-timers --all | grep -Ei 'paper|update' || true
```

确认旧 timer 已停止后，再进行切换。`oh-my-paper-update.service` 是 oneshot 服务，显示 `inactive (dead)` 属于正常状态。

## 2. 切换代码到 v2

```bash
cd ~/oh-my-paper
git fetch origin
git switch v2
git reset --hard origin/v2
```

如果本地仓库没有 `v2` 分支：

```bash
git switch --track -c v2 origin/v2
```

不要用旧版的 Compose 文件、旧版 `worker` 配置或旧版部署脚本覆盖当前目录。v2 使用 `ai-worker` 服务。

## 3. 检查生产配置

保留当前 `.env`，不要用 `.env.example` 覆盖。至少确认这些值正确：

```dotenv
APP_DOMAIN=你的生产域名
POSTGRES_PASSWORD=你的数据库密码
DEPLOY_DATABASE_URL=postgresql://paper:密码@db:5432/oh_my_paper
BETTER_AUTH_URL=https://你的生产域名
BETTER_AUTH_SECRET=持久的认证密钥
PROVIDER_KEY_ENCRYPTION_KEY=持久的提供商密钥
APP_VERSION=latest
```

`POSTGRES_USER`、`POSTGRES_DB` 按当前部署保留；`DEPLOY_DATABASE_URL` 中的主机必须是 `db`。不要更换 `BETTER_AUTH_SECRET` 或 `PROVIDER_KEY_ENCRYPTION_KEY`。

检查 Compose 配置：

```bash
cd ~/oh-my-paper
sudo docker compose -f compose.yaml config --quiet
sudo docker compose -f compose.yaml config --services
```

服务列表应包含 `db`、`migrate`、`web`、`ai-worker`、`proxy`。

## 4. 拉取并启动最新版本

如果 GHCR 镜像是私有的，先使用有 `read:packages` 权限的账号登录：

```bash
sudo docker login ghcr.io
```

服务器还需安装 Docker Buildx 插件和 Python 3。确认 [v2 GitHub Actions](https://github.com/TaiRuiQu/oh-my-paper/actions) 最新一次 Validate、三个 Docker 任务及「Publish complete release and clean GHCR」都成功后执行：

```bash
cd ~/oh-my-paper
sudo docker compose -f compose.yaml pull db qdrant proxy
sudo bash deploy/update.sh
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 migrate web ai-worker
```

`--remove-orphans` 会清理旧版 `worker` 容器。v2 的 `migrate` 会按 Compose 依赖启动，完成后 Web 和 AI Worker 才会运行。不要使用 `sudo docker compose down -v`。

验证站点：

```bash
curl -fsS https://你的生产域名/api/health
```

应返回 `status: "ok"`。再用原账号登录，确认 Web 和 AI Worker 日志正常。

## 5. 安装新的 systemd 定时器

systemd 以 root 运行，unit 中必须使用项目绝对路径，不能写 `~`：

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

sudo cp "$PAPER_DEPLOY_DIR/deploy/oh-my-paper-update.timer" /etc/systemd/system/oh-my-paper-update.timer
sudo systemctl daemon-reload
sudo systemctl enable --now oh-my-paper-update.timer
```

先手动运行一次，确认 root 的 Docker/GHCR 凭据、路径和权限都正确：

```bash
sudo systemctl start oh-my-paper-update.service
sudo systemctl status oh-my-paper-update.service --no-pager
sudo journalctl -u oh-my-paper-update.service -n 100 --no-pager
sudo systemctl status oh-my-paper-update.timer --no-pager
sudo systemctl list-timers --all oh-my-paper-update.timer
```

oneshot 服务成功后显示 `inactive (dead)` 是正常的，应看到 `status=0/SUCCESS`。timer 应为 `active (waiting)`，并显示下一次触发时间。不要 enable service 本身，只 enable timer。

新的 service 直接调用当前仓库的 `deploy/update.sh`，不要沿用旧 unit 中内联的 pull/up 命令。脚本读取一次完整发布入口，按固定 digest 拉取三个应用镜像；全部拉取成功后保存 `deploy/.release.json`，再执行 `up --wait --wait-timeout 180`。任一镜像拉取失败时保留原服务和原本地清单。在新服务就绪后自动清理本项目未使用的旧 Docker 镜像；部署失败时跳过清理。同一个 timer 已包含部署和清理，不需要再安装清理 timer。

清理相当于以下命令，它只匹配本项目发布镜像的来源标签：

```bash
sudo docker image prune -a -f \
  --filter 'label=org.opencontainers.image.source=https://github.com/TaiRuiQu/oh-my-paper'
```

Docker 会保留仍被任何容器引用的镜像，包括停止的容器；旧容器尚未移除时，对应镜像也会保留。此命令不删除数据库或文件卷，也不会清理 PostgreSQL、Caddy 或其他项目的镜像。旧版缺少来源标签的镜像需要单独检查处理。

GHCR 的清理由 GitHub Actions 在发布完整入口后执行：按完整发布保留三个版本（始终保留 `latest`），并保留它们引用的 Web、migrate、ai-worker digest 和多架构子清单。未完成构建的暂存镜像保留至少一天，供其他仍运行的构建完成；因此 GHCR 页面可能显示额外条目。发布和清理串行执行。更早的 release tag 不会永久保留；需要回滚时请选仍保留的完整 SHA 版本。服务器本地清理不保留三份缓存，需要回滚时从 GHCR 重新拉取。

## 6. 之后的更新

`v2` 每次 push 的三个镜像全部通过验收并推送后，才会发布包含整组 digest 的 `latest` 入口。服务器 timer 每五分钟检查一次，并以 root 身份执行 `deploy/update.sh`。即使构建速度不同、部分任务失败或取消，也不会通过统一入口部署到新旧混合的一组镜像：

```bash
cd ~/oh-my-paper
sudo bash deploy/update.sh
```

临时固定某个已发布版本时，修改 `.env` 中的 `APP_VERSION=sha-<完整40位提交SHA>`，执行一次上面的命令；恢复自动跟踪时改回 `APP_VERSION=latest`，然后：

```bash
sudo systemctl enable --now oh-my-paper-update.timer
```

常用检查：

```bash
sudo systemctl list-timers --all oh-my-paper-update.timer
sudo journalctl -u oh-my-paper-update.service --since today --no-pager
cd ~/oh-my-paper
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 web ai-worker
```
