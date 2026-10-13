#!/usr/bin/env bash
# 定时升级脚本：拉取最新镜像 -> 按 compose 依赖顺序滚动 -> 清理旧镜像。
# 由 deploy/oh-my-paper-update.timer 调用，也可手动执行。
# 私有镜像时需要 root 已执行 docker login ghcr.io（systemd 与 cron 都使用 root 凭据）。
# 仅更新镜像；Compose 文件、部署脚本和宿主机设置需另行同步。
set -euo pipefail
cd "$(dirname "$0")/.."
exec 9>./.update.lock
flock -n 9 || exit 0
compose=(docker compose -f compose.yaml -f compose.release.yaml)
# db 与 proxy 使用固定版本镜像，升级应显式进行，不在自动更新范围内。
"${compose[@]}" pull migrate web worker
"${compose[@]}" up -d --remove-orphans
docker image prune -f
