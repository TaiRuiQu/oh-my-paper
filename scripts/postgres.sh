#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/env.sh"
PG_ROOT="$PROJECT_ROOT/.local/postgresql"
PG_DATA="$PG_ROOT/data"
case "${1:-status}" in
  start)
    if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
      echo '数据库尚未初始化，请参阅 docs/development-setup.zh-CN.md。' >&2
      exit 1
    fi
    if pg_ctl -D "$PG_DATA" status >/dev/null 2>&1; then
      pg_ctl -D "$PG_DATA" status
    else
      pg_ctl -D "$PG_DATA" -l "$PG_ROOT/server.log" -w start
    fi
    ;;
  stop) pg_ctl -D "$PG_DATA" -m fast -w stop ;;
  status) pg_ctl -D "$PG_DATA" status ;;
  *) echo '用法：bash scripts/postgres.sh {start|stop|status}' >&2; exit 2 ;;
esac
