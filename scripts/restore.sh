#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_directory="${1:?Usage: bash scripts/restore.sh /absolute/backup-batch}"
(cd "$backup_directory" && sha256sum -c SHA256SUMS)
# Restore is intentionally restricted to a fresh, empty installation.
existing_tables="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'"')"
if [[ "$existing_tables" != 0 ]]; then printf 'Restore requires an empty database. Use a fresh deployment.\n' >&2; exit 1; fi
mkdir -p storage
if [[ -n "$(find storage -mindepth 1 -print -quit)" ]]; then printf 'Restore requires an empty storage directory.\n' >&2; exit 1; fi
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$backup_directory/database.dump"
tar -xzf "$backup_directory/storage.tar.gz" -C storage --no-same-owner
printf 'Restore complete. Fix storage permissions and start web/ai-worker using the original encryption key.\n'
