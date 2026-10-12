# 单机部署与联合备份

本地开发使用本机 PostgreSQL，启动步骤见 [本地开发说明](development-setup.zh-CN.md)。仓库提供 Web/Worker 多阶段 Dockerfile、Compose、Caddy HTTPS 配置与联合备份/恢复脚本。容器构建、Compose 启动和恢复演练尚未完成验收。

生产机准备 Docker Engine/Compose 和指向服务器的域名。在 `.env` 中配置以下项目，保留原来的登录及 AI 凭据加密密钥。不要把本机 `localhost` 数据库地址用于容器。

```dotenv
APP_DOMAIN=paper.example.com
BETTER_AUTH_URL=https://paper.example.com
POSTGRES_USER=paper
POSTGRES_DB=oh_my_paper
POSTGRES_PASSWORD=设置随机密码
DEPLOY_DATABASE_URL=postgresql://paper:URL编码后的密码@db:5432/oh_my_paper
STORAGE_ROOT=/data/storage
TEMP_ROOT=/data/tmp
WORKER_CONCURRENCY=2
```

新部署还需按 `.env.example` 设置 `BETTER_AUTH_SECRET` 和 `PROVIDER_KEY_ENCRYPTION_KEY`，两者不要丢失。上传与临时目录需要容器中的 Node 用户（UID/GID 1000）可写，建议只对这两个目录设置权限。

```bash
mkdir -p storage tmp
sudo chown -R 1000:1000 storage tmp
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web worker migrate
```

数据库不公开端口。迁移服务成功结束后 Web/Worker 启动；Caddy 等待 Web 健康。Worker 健康检查查询最近数据库心跳。`WORKER_CONCURRENCY` 是每类队列的并发数；识别、批改和练习可以同时执行，按服务器资源降低并发。模型请求另受后台提供商最大并发数限制，多个 Worker 各自限流。当前未设置硬性磁盘配额或账号费用额度。

联合备份会短暂停止 Web 和 Worker，使数据库与文件落在同一个静止时点，结束时自动启动。备份写入 PostgreSQL 自定义格式转储、用户文件压缩包和 SHA256 校验。

```bash
bash scripts/backup.sh /srv/paper-backups
```

将备份复制到另一块存储，单独安全保存 `.env` 密钥与部署版本。备份内容包含用户文件，应使用受限权限和适当留存；磁盘挂载本身不等于备份。

恢复脚本只允许空数据库、空文件目录，避免覆盖现有数据。在新的恢复环境配置原始密钥，先 `docker compose up -d db`，再执行以下步骤：

```bash
bash scripts/restore.sh /srv/paper-backups/某个备份批次
sudo chown -R 1000:1000 storage tmp
docker compose up -d --build
```

恢复后验证登录、原图读取、报告下载、后台心跳和队列消费。每次生产发布前应在测试环境进行恢复演练。现有脚本只完成语法检查，尚未做容器或真实备份恢复验收。
