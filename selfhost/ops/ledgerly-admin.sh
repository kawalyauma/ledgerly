#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_require docker
ops_require curl
ops_load_env

api_ready(){ curl --fail --silent --show-error --max-time 5 "$(ops_api_url)/selfhost/ready"; }
minio_ready(){ curl --fail --silent --show-error --max-time 5 "$(ops_minio_url)/minio/health/ready" >/dev/null; }

cmd_services(){
  ops_heading "Services"
  ops_compose ps
}

cmd_database(){
  ops_heading "PostgreSQL"
  ops_compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  ops_compose exec -T postgres psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off -c \
    "SELECT current_database() AS database, current_setting('max_connections') AS max_connections, count(*) AS open_connections FROM pg_stat_activity;"
  ops_heading "PgBouncer pools"
  ops_compose exec -T pgbouncer sh -ec 'PGPASSWORD="$DATABASE_PASSWORD" psql -X -h 127.0.0.1 -p 6432 -U "$DATABASE_USER" pgbouncer -P pager=off -c "SHOW POOLS;"'
}

cmd_cache(){
  ops_heading "Redis"
  ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli ping
  ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli --no-auth-warning INFO memory | grep -E '^(used_memory_human|maxmemory_human|mem_fragmentation_ratio):' || true
  ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli --no-auth-warning INFO persistence | grep -E '^(aof_enabled|aof_last_bgrewrite_status|rdb_last_bgsave_status):' || true
}

cmd_queues(){
  ops_heading "Queue and scheduler readiness"
  api_ready
  ops_heading "Queue-related Redis keys (names only)"
  ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli --no-auth-warning --scan --pattern "${LEDGERLY_REDIS_NAMESPACE:-ledgerly:selfhost}:*" | grep -E 'queue|job|dead|retry|schedule' | head -100 || true
}

cmd_storage(){
  ops_heading "MinIO"
  minio_ready && echo "MinIO readiness: ok"
  ops_heading "Disk usage"
  df -hT "$BACKUP_ROOT" "${CAMERA_STORAGE_ROOT:-$LEDGERLY_REPO_ROOT/camera-storage}" 2>/dev/null || df -hT "$LEDGERLY_REPO_ROOT"
  if [[ -d "$BACKUP_ROOT" ]]; then du -sh "$BACKUP_ROOT" 2>/dev/null || true; fi
  if [[ -d "${CAMERA_STORAGE_ROOT:-$LEDGERLY_REPO_ROOT/camera-storage}" ]]; then du -sh "${CAMERA_STORAGE_ROOT:-$LEDGERLY_REPO_ROOT/camera-storage}" 2>/dev/null || true; fi
}

cmd_backups(){
  ops_heading "Backup freshness"
  BACKUP_ROOT="$BACKUP_ROOT" "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh"
  ops_heading "Latest verified manifest"
  if [[ -r "$BACKUP_ROOT/status/last-success.json" ]]; then cat "$BACKUP_ROOT/status/last-success.json"; echo; else echo "No last-success manifest found"; return 1; fi
}

cmd_nvr(){
  ops_heading "NVR / MediaMTX"
  if [[ -f "$LEDGERLY_FINANCE_COMPOSE_FILE" ]]; then ops_compose ps nvr-mediamtx || true; fi
  local port="${CAMERA_WEBRTC_HTTP_HOST_PORT:-8889}"
  if ops_tcp_check 127.0.0.1 "$port"; then echo "MediaMTX WebRTC HTTP port $port: reachable on loopback"; else echo "MediaMTX WebRTC HTTP port $port: unavailable"; return 1; fi
  local root="${CAMERA_STORAGE_ROOT:-$LEDGERLY_REPO_ROOT/camera-storage}"
  [[ -e "$root" ]] && df -hT "$root" || true
}

cmd_updates(){
  ops_heading "Configured container images"
  ops_compose config --images | sort -u
  ops_heading "Update policy"
  echo "Automatic image pulling is disabled. Use the controlled upgrade/rollback runbook; pin and validate images before production rollout."
}

cmd_logs(){
  local service="${1:-}"
  if [[ -n "$service" ]]; then ops_compose logs --tail="${OPS_LOG_TAIL:-200}" "$service"; else ops_compose logs --tail="${OPS_LOG_TAIL:-200}"; fi
}

run_overview_check(){
  local label="$1"; shift
  printf '%-28s' "$label"
  if "$@" >/tmp/ledgerly-ops-check.$$ 2>&1; then echo "OK"; else echo "FAIL"; sed 's/^/  /' /tmp/ledgerly-ops-check.$$ | tail -6; return 1; fi
}

cmd_overview(){
  local failed=0
  ops_heading "Ledgerly operations overview"
  run_overview_check "Node API readiness" api_ready || failed=1
  run_overview_check "PostgreSQL" ops_compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || failed=1
  run_overview_check "PgBouncer" ops_compose exec -T pgbouncer pg_isready -h 127.0.0.1 -p 6432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" || failed=1
  run_overview_check "Redis" ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli --no-auth-warning ping || failed=1
  run_overview_check "MinIO" minio_ready || failed=1
  if [[ -x "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh" ]]; then
    run_overview_check "Backup freshness" env BACKUP_ROOT="$BACKUP_ROOT" BACKUP_FRESHNESS_SECONDS="${BACKUP_FRESHNESS_SECONDS:-93600}" "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh" || failed=1
  else
    echo "Backup freshness            FAIL (checker missing)"; failed=1
  fi
  local disk_path="$LEDGERLY_REPO_ROOT" use
  use="$(df -P "$disk_path" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  printf '%-28s%s%% used\n' "Server disk" "$use"
  (( use < ${OPS_DISK_CRITICAL_PERCENT:-90} )) || failed=1
  rm -f /tmp/ledgerly-ops-check.$$
  return "$failed"
}

usage(){
  cat <<'TXT'
Usage: ledgerly-admin.sh <surface> [service]
Surfaces: overview services database cache queues storage backups logs nvr updates
The command is host-only and is never routed through Caddy.
TXT
}

command="${1:-overview}"; shift || true
case "$command" in
  overview) cmd_overview ;;
  services) cmd_services ;;
  database) cmd_database ;;
  cache) cmd_cache ;;
  queues) cmd_queues ;;
  storage) cmd_storage ;;
  backups) cmd_backups ;;
  logs) cmd_logs "${1:-}" ;;
  nvr) cmd_nvr ;;
  updates) cmd_updates ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
