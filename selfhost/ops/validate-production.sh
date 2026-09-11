#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_load_env
pass=0; fail=0; skip=0
PASS(){ echo "PASS  $*"; pass=$((pass+1)); }
FAIL(){ echo "FAIL  $*"; fail=$((fail+1)); }
SKIP(){ echo "SKIP  $*"; skip=$((skip+1)); }

check_cmd(){ command -v "$1" >/dev/null 2>&1; }

syntax_bad=0
while IFS= read -r -d '' f; do bash -n "$f" || syntax_bad=1; done < <(find "$LEDGERLY_REPO_ROOT/selfhost" -type f -name '*.sh' -print0)
(( syntax_bad == 0 )) && PASS "shell syntax" || FAIL "shell syntax"

if check_cmd docker; then
  if ops_compose config -q; then PASS "Compose configuration"; else FAIL "Compose configuration"; fi
else SKIP "Compose configuration (docker unavailable)"; fi

port_bad=0
for spec in \
  'postgres:127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432' \
  'pgbouncer:127.0.0.1:${PGBOUNCER_HOST_PORT:-6432}:6432' \
  'redis:127.0.0.1:${REDIS_HOST_PORT:-6379}:6379' \
  'minio-api:127.0.0.1:${MINIO_API_HOST_PORT:-9000}:9000' \
  'minio-console:127.0.0.1:${MINIO_CONSOLE_HOST_PORT:-9001}:9001' \
  'node-api:127.0.0.1:${LEDGERLY_API_PORT:-8788}:8788'; do
  label="${spec%%:*}"; expected="${spec#*:}"
  if grep -Fq -- "\"$expected\"" "$LEDGERLY_COMPOSE_FILE"; then :; else echo "  missing loopback-only mapping for $label"; port_bad=1; fi
done
(( port_bad == 0 )) && PASS "private services bind only to loopback" || FAIL "private service port policy"

grep -Eq '^\s*admin off\s*$' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile" && PASS "Caddy admin API disabled" || FAIL "Caddy admin API disabled"
if grep -Eq 'reverse_proxy[[:space:]]+(postgres|pgbouncer|redis|minio)(:|[[:space:]])' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile"; then FAIL "private data services absent from public proxy"; else PASS "private data services absent from public proxy"; fi

secret_bad=0
for v in POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_PASSWORD LEDGERLY_JWT_SECRET; do
  val="${!v:-}"
  [[ -n "$val" && "$val" != *CHANGE_ME* ]] || { echo "  unset/example secret: $v"; secret_bad=1; }
done
if [[ "${LEDGERLY_ENVIRONMENT:-development}" == "production" ]]; then
  [[ "${LEDGERLY_DATABASE_APP_USER:-}" != "" && "${LEDGERLY_DATABASE_APP_USER:-}" != "$POSTGRES_USER" ]] || { echo "  production requires a non-superuser LEDGERLY_DATABASE_APP_USER"; secret_bad=1; }
  [[ -n "${LEDGERLY_DATABASE_APP_PASSWORD:-}" && "${LEDGERLY_DATABASE_APP_PASSWORD:-}" != *CHANGE_ME* ]] || { echo "  production requires LEDGERLY_DATABASE_APP_PASSWORD"; secret_bad=1; }
fi
(( secret_bad == 0 )) && PASS "secret/least-privilege configuration gate" || FAIL "secret/least-privilege configuration gate"

if OPS_SKIP_DB_DIAGNOSTICS=true "$LEDGERLY_REPO_ROOT/selfhost/ops/performance-audit.sh" >/tmp/ledgerly-perf-audit.$$ 2>&1; then PASS "database pool bounds"; else cat /tmp/ledgerly-perf-audit.$$; FAIL "database pool bounds"; fi
rm -f /tmp/ledgerly-perf-audit.$$

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if BACKUP_ROOT="$tmp" BACKUP_MIN_FREE_BYTES=9223372036854775807 bash -c 'source "$1"; preflight_disk' _ "$LEDGERLY_REPO_ROOT/selfhost/backups/common.sh" >/dev/null 2>&1; then
  FAIL "backup disk-full safeguard"
else PASS "backup disk-full safeguard"; fi

if [[ "${OPS_LIVE_TESTS:-false}" == "true" ]]; then
  if "$LEDGERLY_REPO_ROOT/selfhost/ops/health-check.sh" >/dev/null; then PASS "live service health"; else FAIL "live service health"; fi
  if [[ -s "$BACKUP_ROOT/status/last-success-set" ]]; then
    latest="$(cat "$BACKUP_ROOT/status/last-success-set")"
    if "$LEDGERLY_REPO_ROOT/selfhost/backups/verify-backup.sh" "$latest" >/dev/null; then PASS "latest backup checksums"; else FAIL "latest backup checksums"; fi
    if [[ "${OPS_DESTRUCTIVE_TESTS:-false}" == "true" ]]; then
      if "$LEDGERLY_REPO_ROOT/selfhost/backups/test-restore.sh" "$latest" >/dev/null; then PASS "scratch restore validation"; else FAIL "scratch restore validation"; fi
    else SKIP "scratch restore validation (set OPS_DESTRUCTIVE_TESTS=true on a rehearsal host)"; fi
  else FAIL "latest backup exists"; fi
  if [[ "${OPS_DESTRUCTIVE_TESTS:-false}" == "true" ]]; then
    SKIP "graceful API/Redis/queue restart fault injection must be run only on a rehearsal host using the runbook"
  else SKIP "graceful API/Redis/queue restart fault injection (destructive tests disabled)"; fi
else
  SKIP "live service health (set OPS_LIVE_TESTS=true on the target host)"
  SKIP "backup checksum/restore live validation (live tests disabled)"
  SKIP "graceful API/Redis/queue reconnect fault injection (live tests disabled)"
fi

printf '\nValidation summary: %s passed, %s failed, %s skipped\n' "$pass" "$fail" "$skip"
(( fail == 0 ))
