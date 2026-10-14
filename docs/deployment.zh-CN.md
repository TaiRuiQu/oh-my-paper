# Oh My Paper v2 部署指南

本文描述当前 v2 镜像部署方式。已有 0.1.15 生产环境请先阅读 [从 0.1.15 升级到 v2](upgrade-from-v0.1.15.zh-CN.md)，不要直接执行全新部署步骤。

生产服务由 PostgreSQL、Web、AI Worker 和 Caddy 组成。v2 的应用镜像发布在 GHCR：`oh-my-paper`、`oh-my-paper-migrate` 和 `oh-my-paper-ai-worker`。服务器定时器每五分钟检查并拉取 `latest` 镜像；GitHub Actions 负责验证和发布镜像，不会替服务器同步 Compose 文件或部署脚本。

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
- `APP_VERSION=latest`：跟踪最新 v2 镜像。

已有部署必须保留原认证密钥、提供商加密密钥和数据库凭据。私有仓库或私有 GHCR 镜像先登录：

```bash
sudo docker login ghcr.io
```

启动并验证：

```bash
cd ~/oh-my-paper
sudo docker compose -f compose.yaml -f compose.release.yaml pull
sudo docker compose -f compose.yaml -f compose.release.yaml up -d --remove-orphans --wait --wait-timeout 180
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 migrate web ai-worker
curl -fsS https://你的域名/api/health
```

`migrate` 成功退出后，Web 和 AI Worker 才会启动。AI Worker 必须保持运行，否则 AI 任务会停留在队列中。不要使用 `sudo docker compose down -v`，它会删除数据库和 Caddy 持久卷。

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

脚本默认从 `APP_VERSION` 读取版本；未设置时跟踪 `latest`。手动更新也要使用 `sudo`：

```bash
cd ~/oh-my-paper
sudo bash deploy/update.sh
```

固定某个已发布镜像进行回滚时，先停用 timer，再编辑 `.env`：

```bash
sudo systemctl disable --now oh-my-paper-update.timer
sed -i '/^APP_VERSION=/d' .env
printf '\nAPP_VERSION=sha-xxxxxxx\n' >> .env
sudo bash deploy/update.sh
```

恢复自动更新时改回 `APP_VERSION=latest`，手动确认成功后执行：

```bash
sudo systemctl enable --now oh-my-paper-update.timer
```

## 日常检查

```bash
sudo systemctl list-timers --all oh-my-paper-update.timer
sudo journalctl -u oh-my-paper-update.service --since today --no-pager
cd ~/oh-my-paper
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 web ai-worker
```

已有 0.1.15 服务器切换到 v2 时，请使用 [升级专用指南](upgrade-from-v0.1.15.zh-CN.md)。
