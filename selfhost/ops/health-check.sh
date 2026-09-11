#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_require docker; ops_require curl; ops_require python3
ops_load_env
failures=()
check(){ local name="$1"; shift; if ! "$@" >/dev/null 2>&1; then failures+=("$name"); fi; }

readiness_json="$(curl --fail --silent --show-error --max-time 8 "$(ops_api_url)/selfhost/ready" 2>/dev/null || true)"
if [[ -z "$readiness_json" ]]; then failures+=(node_api); else
  if ! READY_JSON="$readiness_json" SCHEDULER_ENABLED="${LEDGERLY_SCHEDULER_ENABLED:-true}" python3 - <<'PY'
import json, os, sys
data=json.loads(os.environ['READY_JSON']); errors=[]
for name,item in (data.get('dependencies') or {}).items():
    if not isinstance(item,dict) or item.get('ok') is not True: errors.append(f'dependency:{name}')
for name,item in (data.get('extensions') or {}).items():
    if not isinstance(item,dict) or item.get('ok') is not True: errors.append(f'extension:{name}')
if os.environ.get('SCHEDULER_ENABLED','true').lower() in ('1','true','yes','on') and (data.get('schedulerRunner') or {}).get('running') is not True:
    errors.append('schedulerRunner')
if errors: print(','.join(errors),file=sys.stderr); raise SystemExit(1)
PY
  then failures+=(runtime_readiness); fi
fi
check postgres ops_compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
check pgbouncer ops_compose exec -T pgbouncer pg_isready -h 127.0.0.1 -p 6432 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
check redis ops_compose exec -T -e REDISCLI_AUTH="$REDIS_PASSWORD" redis redis-cli --no-auth-warning ping
check minio curl --fail --silent --max-time 5 "$(ops_minio_url)/minio/health/ready"
if [[ -x "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh" ]]; then
  check backup_freshness env BACKUP_ROOT="$BACKUP_ROOT" BACKUP_FRESHNESS_SECONDS="${BACKUP_FRESHNESS_SECONDS:-93600}" "$LEDGERLY_REPO_ROOT/selfhost/backups/check-freshness.sh"
else failures+=(backup_freshness); fi
if [[ "${RESTORE_TEST_REQUIRED:-false}" == "true" ]]; then
  epoch_file="$BACKUP_ROOT/status/last-restore-test-epoch"
  if [[ ! -s "$epoch_file" ]]; then failures+=(restore_test_missing); else
    epoch="$(cat "$epoch_file")"; now="$(date +%s)"
    if [[ ! "$epoch" =~ ^[0-9]+$ ]] || (( now - epoch > ${RESTORE_TEST_FRESHNESS_SECONDS:-691200} )); then failures+=(restore_test_stale); fi
  fi
fi
use="$(df -P "$LEDGERLY_REPO_ROOT" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
[[ "$use" =~ ^[0-9]+$ ]] || failures+=(disk_probe)
if [[ "$use" =~ ^[0-9]+$ ]] && (( use >= ${OPS_DISK_CRITICAL_PERCENT:-90} )); then failures+=(disk_full); fi
nvr_root="${CAMERA_STORAGE_ROOT:-$LEDGERLY_REPO_ROOT/camera-storage}"
if [[ -e "$nvr_root" ]]; then
  nvr_use="$(df -P "$nvr_root" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  [[ "$nvr_use" =~ ^[0-9]+$ ]] || failures+=(nvr_disk_probe)
  if [[ "$nvr_use" =~ ^[0-9]+$ ]] && (( nvr_use >= ${OPS_NVR_DISK_CRITICAL_PERCENT:-90} )); then failures+=(nvr_disk_full); fi
fi
if ((${#failures[@]})); then
  printf '{"ok":false,"checked_at":"%s","disk_used_percent":%s,"failures":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${use:-null}" "$(IFS=,; echo "${failures[*]}")"; exit 1
fi
printf '{"ok":true,"checked_at":"%s","disk_used_percent":%s,"failures":""}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$use"
