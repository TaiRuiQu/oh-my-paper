#!/usr/bin/env bash
# Run: source scripts/env.sh
PAPER_PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PAPER_PROJECT_ROOT/.tools/postgresql/usr/lib/postgresql/18/bin:$PAPER_PROJECT_ROOT/.venv/bin:$PATH"
export LD_LIBRARY_PATH="$PAPER_PROJECT_ROOT/.tools/postgresql/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PLAYWRIGHT_BROWSERS_PATH="$PAPER_PROJECT_ROOT/.local/playwright"
unset PAPER_PROJECT_ROOT
