#!/usr/bin/env bash
set -euo pipefail

target=${1:?Expected web, ai-worker or migrate}
case "$target" in web|ai-worker|migrate) ;; *) exit 2 ;; esac
network="omp-smoke-${target}-$$"
database="${network}-db"
runtime="${network}-app"
cleanup() {
  docker logs "$runtime" 2>&1 || true
  docker rm -f "$runtime" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_USER=paper -e POSTGRES_PASSWORD=paper -e POSTGRES_DB=paper_ci \
  postgres:18.6-bookworm >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$database" pg_isready -U paper -d paper_ci >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
environment=(
  -e "DATABASE_URL=postgresql://paper:paper@${database}:5432/paper_ci"
  -e BETTER_AUTH_URL=http://localhost:3000
  -e BETTER_AUTH_SECRET=ci-auth-secret-for-isolated-test-environment-2026
  -e PROVIDER_KEY_ENCRYPTION_KEY=ci-provider-secret-for-isolated-test-environment-2026
)
docker run --rm --network "$network" "${environment[@]}" omp-runtime:migrate
if [ "$target" = migrate ]; then
  echo 'Migration image completed successfully'
  exit 0
fi
docker run -d --name "$runtime" --network "$network" \
  "${environment[@]}" "omp-runtime:${target}" >/dev/null
ready=false
for attempt in {1..60}; do
  test "$(docker inspect --format '{{.State.Running}}' "$runtime")" = true
  if [ "$target" = web ]; then
    if docker exec "$runtime" node -e \
      'fetch("http://localhost:3000/api/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'; then
      ready=true
      break
    fi
  elif docker logs "$runtime" 2>&1 | grep -q 'platform.ai.worker.started'; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
# Allow several queue polls to catch failures after module loading.
sleep 10
test "$(docker inspect --format '{{.State.Running}}' "$runtime")" = true
if docker logs "$runtime" 2>&1 | grep -Eq 'ERR_MODULE_NOT_FOUND|platform.ai.worker.poll.failed'; then
  exit 1
fi
echo "${target} image startup acceptance passed"
