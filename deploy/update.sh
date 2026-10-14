#!/usr/bin/env bash
# 发布升级脚本：拉取指定版本镜像 -> 等待服务就绪 -> 清理本项目未使用的旧镜像。
# GitHub Actions 在 v2 每次 push 后发布镜像；timer 定时拉取，也可手动执行。
# 私有镜像时需要 root 已执行 docker login ghcr.io（systemd 与 cron 都使用 root 凭据）。
# APP_VERSION 可指定 sha-xxxxxxx 或 release tag；未指定时跟踪 latest。
set -euo pipefail
cd "$(dirname "$0")/.."
exec 9>./deploy/.update.lock
flock -n 9 || exit 0
compose=(docker compose -f compose.yaml -f compose.release.yaml)
# db 与 proxy 使用固定版本镜像，升级应显式进行，不在自动更新范围内。
"${compose[@]}" pull migrate web ai-worker
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 180
# Only images published by this repository; Docker retains any image referenced
# by a container. Database/Caddy images and volumes are outside this filter.
docker image prune -a -f \
  --filter 'label=org.opencontainers.image.source=https://github.com/TaiRuiQu/oh-my-paper'
