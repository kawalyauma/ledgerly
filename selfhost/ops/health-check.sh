#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_require docker
ops_require curl
ops_load_env
failures=()
check(){ local name="$1"; shift; if ! "$@" >/dev/null 2>&1; then failures+=("$name"); fi; }
check node_api curl --fail --silent --max-time 5 "$(ops_api_url)/selfhost/ready"
check postgres ops_compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
check pgbouncer ops_compose exec -T pgbouncer pg_isready -h 127.0.0.1 -p 6432 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
check redis ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli --no-auth-warning ping
check minio curl --fail --silent --max-time 5 "$(ops_minio_url)/minio/health/ready"
if [[ -x "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh" ]]; then
  check backup_freshness env BACKUP_ROOT="$BACKUP_ROOT" BACKUP_FRESHNESS_SECONDS="${BACKUP_FRESHNESS_SECONDS:-93600}" "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh"
else failures+=(backup_freshness); fi
use="$(df -P "$LEDGERLY_REPO_ROOT" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
[[ "$use" =~ ^[0-9]+$ ]] || failures+=(disk_probe)
if [[ "$use" =~ ^[0-9]+$ ]] && (( use >= ${OPS_DISK_CRITICAL_PERCENT:-90} )); then failures+=(disk_full); fi
if ((${#failures[@]})); then
  printf '{"ok":false,"checked_at":"%s","disk_used_percent":%s,"failures":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${use:-null}" "$(IFS=,; echo "${failures[*]}")"
  exit 1
fi
printf '{"ok":true,"checked_at":"%s","disk_used_percent":%s,"failures":""}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$use"
