#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
backup_root="${1:?Usage: bash scripts/backup.sh /absolute/backup-directory}"
mkdir -p "$backup_root"
backup_directory="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$backup_directory"
# Quiesce writers so database and files describe the same completed operations.
docker compose stop web ai-worker
trap 'docker compose start web ai-worker >/dev/null' EXIT
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_directory/database.dump"
tar -czf "$backup_directory/storage.tar.gz" -C storage .
(cd "$backup_directory" && sha256sum database.dump storage.tar.gz > SHA256SUMS)
printf 'Backup saved: %s\n' "$backup_directory"
