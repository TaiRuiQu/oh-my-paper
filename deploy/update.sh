#!/usr/bin/env bash
# 私有镜像时需要 root 已执行 docker login ghcr.io（systemd 与 cron 都使用 root 凭据）。
set -euo pipefail
cd "$(dirname "$0")/.."
exec 9>./deploy/.update.lock
flock -n 9 || exit 0
version="$(docker compose -f compose.yaml config --environment | sed -n 's/^APP_VERSION=//p')"
version="${version:-latest}"
if [[ ! "$version" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
  echo 'APP_VERSION must be a valid release tag' >&2
  exit 1
fi
release_file="$(mktemp ./deploy/.release.XXXXXX.json)"
trap 'rm -f "$release_file"' EXIT
# Read latest exactly once. All subsequent pulls use immutable digests from
# this snapshot even if another release is published during the update.
docker buildx imagetools inspect "ghcr.io/tairuiqu/oh-my-paper:${version}" \
  --format '{{json .Manifest}}' | python3 deploy/resolve-release.py > "$release_file"
# db 与 proxy 使用固定版本镜像，升级应显式进行，不在自动更新范围内。
docker compose -f compose.yaml -f "$release_file" pull migrate web ai-worker
# Failed resolution/pulls leave both the running containers and the previous
# local release selection untouched. Manual Compose commands reuse this lock.
mv -f "$release_file" ./deploy/.release.json
compose=(docker compose -f compose.yaml -f compose.release.yaml)
"${compose[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 180
# Only images published by this repository; Docker retains any image referenced
# by a container. Database/Caddy images and volumes are outside this filter.
docker image prune -a -f \
  --filter 'label=org.opencontainers.image.source=https://github.com/TaiRuiQu/oh-my-paper'
