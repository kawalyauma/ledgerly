#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_load_env
pass=0; fail=0; skip=0
PASS(){ echo "PASS  $*"; pass=$((pass+1)); }
FAIL(){ echo "FAIL  $*"; fail=$((fail+1)); }
SKIP(){ echo "SKIP  $*"; skip=$((skip+1)); }
check_cmd(){ command -v "$1" >/dev/null 2>&1; }
production=false; [[ "${LEDGERLY_ENVIRONMENT:-development}" == "production" ]] && production=true

syntax_bad=0
while IFS= read -r -d '' f; do bash -n "$f" || syntax_bad=1; done < <(find "$LEDGERLY_REPO_ROOT/selfhost" -type f -name '*.sh' -print0)
(( syntax_bad == 0 )) && PASS "shell syntax" || FAIL "shell syntax"

node_bad=0
if check_cmd node; then
  for f in "$LEDGERLY_REPO_ROOT/server/src/index.mjs" "$LEDGERLY_REPO_ROOT/server/src/config.mjs"; do
    node --check "$f" >/dev/null 2>&1 || { echo "  Node syntax failed: $f"; node_bad=1; }
  done
  (( node_bad == 0 )) && PASS "Node runtime syntax" || FAIL "Node runtime syntax"
else
  SKIP "Node runtime syntax (node unavailable)"
fi

compose_rendered=""
if check_cmd docker; then
  if ops_compose config -q; then PASS "Compose configuration"; else FAIL "Compose configuration"; fi
  compose_rendered="$(ops_compose config --format json 2>/dev/null || true)"
  if [[ -n "$compose_rendered" ]] && check_cmd python3; then
    if COMPOSE_JSON="$compose_rendered" python3 - <<'PY'
import json, os, sys
cfg=json.loads(os.environ['COMPOSE_JSON'])
services=cfg.get('services') or {}
errors=[]
for name in ('postgres','pgbouncer','redis','minio','api','caddy'):
    svc=services.get(name)
    if not svc: errors.append(f'missing service {name}'); continue
    if svc.get('restart') != 'unless-stopped': errors.append(f'{name}: restart={svc.get("restart")!r}')
for name in ('postgres','pgbouncer','redis','minio','api'):
    for port in (services.get(name) or {}).get('ports') or []:
        host_ip=(port or {}).get('host_ip') if isinstance(port,dict) else None
        if host_ip not in ('127.0.0.1','::1'): errors.append(f'{name}: non-loopback published port {port!r}')
backend=(cfg.get('networks') or {}).get('ledgerly_backend') or {}
if backend.get('internal') is not True: errors.append('ledgerly_backend is not internal')
if errors:
    print('\n'.join(errors),file=sys.stderr); sys.exit(1)
PY
    then PASS "restart policy and rendered network isolation"; else FAIL "restart policy and rendered network isolation"; fi
  else
    SKIP "rendered Compose restart/network inspection"
  fi
else SKIP "Compose configuration (docker unavailable)"; SKIP "rendered Compose restart/network inspection"; fi

port_bad=0
for spec in \
  'postgres:127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432' \
  'pgbouncer:127.0.0.1:${PGBOUNCER_HOST_PORT:-6432}:6432' \
  'redis:127.0.0.1:${REDIS_HOST_PORT:-6379}:6379' \
  'minio-api:127.0.0.1:${MINIO_API_HOST_PORT:-9000}:9000' \
  'minio-console:127.0.0.1:${MINIO_CONSOLE_HOST_PORT:-9001}:9001' \
  'node-api:127.0.0.1:${LEDGERLY_API_PORT:-8788}:8788'; do
  label="${spec%%:*}"; expected="${spec#*:}"
  grep -Fq -- "\"$expected\"" "$LEDGERLY_COMPOSE_FILE" || { echo "  missing loopback-only mapping for $label"; port_bad=1; }
done
if [[ -f "$LEDGERLY_FINANCE_COMPOSE_FILE" ]]; then
  for spec in \
    'nvr-rtsp:127.0.0.1:${CAMERA_RTSP_HOST_PORT:-8554}:8554' \
    'nvr-hls:127.0.0.1:${CAMERA_HLS_HOST_PORT:-8888}:8888' \
    'nvr-webrtc-http:127.0.0.1:${CAMERA_WEBRTC_HTTP_HOST_PORT:-8889}:8889'; do
    label="${spec%%:*}"; expected="${spec#*:}"
    grep -Fq -- "\"$expected\"" "$LEDGERLY_FINANCE_COMPOSE_FILE" || { echo "  missing loopback-only mapping for $label"; port_bad=1; }
  done
fi
(( port_bad == 0 )) && PASS "private services bind only to loopback" || FAIL "private service port policy"

grep -Eq '^\s*admin off\s*$' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile" && PASS "Caddy admin API disabled" || FAIL "Caddy admin API disabled"
if grep -Eq 'reverse_proxy[[:space:]]+(postgres|pgbouncer|redis|minio)(:|[[:space:]])' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile"; then FAIL "private data services absent from public proxy"; else PASS "private data services absent from public proxy"; fi
if grep -Eq '@privateOps path .*\/selfhost\/ready .*\/selfhost\/contracts .*\/selfhost\/ops\*' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile"; then PASS "private ops endpoints blocked at public edge"; else FAIL "private ops endpoints blocked at public edge"; fi
if grep -Fq 'max_size {$LEDGERLY_MAX_REQUEST_BODY:64MB}' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile" && grep -Fq 'LEDGERLY_MAX_REQUEST_BODY_BYTES' "$LEDGERLY_REPO_ROOT/server/src/config.mjs"; then PASS "request body limits"; else FAIL "request body limits"; fi
if grep -Fq 'rateLimitMaxRequests' "$LEDGERLY_REPO_ROOT/server/src/index.mjs" && grep -Fq 'trustProxyHeaders' "$LEDGERLY_REPO_ROOT/server/src/index.mjs" && grep -Fq 'MAX_RATE_BUCKETS' "$LEDGERLY_REPO_ROOT/server/src/index.mjs"; then PASS "bounded rate limit and trusted-proxy handling"; else FAIL "bounded rate limit and trusted-proxy handling"; fi
if grep -Fq 'header_up X-Forwarded-For {remote_host}' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile" && grep -Fq 'header_up X-Real-IP {remote_host}' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile"; then PASS "trusted edge overwrites client IP headers"; else FAIL "trusted edge client IP handling"; fi
grep -Fq 'Strict-Transport-Security "max-age=31536000"' "$LEDGERLY_REPO_ROOT/selfhost/caddy/Caddyfile" && PASS "HSTS policy configured" || FAIL "HSTS policy configured"

secret_bad=0
for v in POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_PASSWORD LEDGERLY_JWT_SECRET; do
  val="${!v:-}"
  [[ -n "$val" && "$val" != *CHANGE_ME* ]] || { echo "  unset/example secret: $v"; secret_bad=1; }
done
if [[ "$production" == true ]]; then
  [[ "${LEDGERLY_DATABASE_APP_USER:-}" != "" && "${LEDGERLY_DATABASE_APP_USER:-}" != "$POSTGRES_USER" ]] || { echo "  production requires a non-owner LEDGERLY_DATABASE_APP_USER"; secret_bad=1; }
  [[ -n "${LEDGERLY_DATABASE_APP_PASSWORD:-}" && "${LEDGERLY_DATABASE_APP_PASSWORD:-}" != *CHANGE_ME* && "${LEDGERLY_DATABASE_APP_PASSWORD:-}" != "${POSTGRES_PASSWORD:-}" ]] || { echo "  production requires a distinct LEDGERLY_DATABASE_APP_PASSWORD"; secret_bad=1; }
  [[ -n "${MINIO_APP_ACCESS_KEY:-}" && "${MINIO_APP_ACCESS_KEY:-}" != "${MINIO_ROOT_USER:-}" ]] || { echo "  production requires a distinct bucket-scoped MINIO_APP_ACCESS_KEY"; secret_bad=1; }
  [[ -n "${MINIO_APP_SECRET_KEY:-}" && "${MINIO_APP_SECRET_KEY:-}" != *CHANGE_ME* && "${MINIO_APP_SECRET_KEY:-}" != "${MINIO_ROOT_PASSWORD:-}" ]] || { echo "  production requires a distinct MINIO_APP_SECRET_KEY"; secret_bad=1; }
  jwt_secret="${LEDGERLY_JWT_SECRET:-}"
  (( ${#jwt_secret} >= 32 )) || { echo "  production JWT secret must be at least 32 characters"; secret_bad=1; }
  pool_max="${LEDGERLY_DATABASE_POOL_MAX:-20}"
  [[ "$pool_max" =~ ^[0-9]+$ ]] && (( pool_max >= 1 && pool_max <= 50 )) || { echo "  LEDGERLY_DATABASE_POOL_MAX must be between 1 and 50"; secret_bad=1; }
  [[ "${LEDGERLY_SITE_ADDRESS:-}" != http://* && "${LEDGERLY_SITE_ADDRESS:-}" != *localhost* && "${LEDGERLY_SITE_ADDRESS:-}" != *127.0.0.1* && -n "${LEDGERLY_SITE_ADDRESS:-}" ]] || { echo "  production requires a non-localhost Caddy site address using automatic HTTPS or explicit https://"; secret_bad=1; }
  [[ "${LEDGERLY_TRUST_PROXY_HEADERS:-true}" =~ ^([Tt][Rr][Uu][Ee]|1|yes|on)$ ]] || { echo "  production Caddy topology requires trusted proxy headers"; secret_bad=1; }
  rate_max="${LEDGERLY_RATE_LIMIT_MAX_REQUESTS:-600}"; access_ttl="${LEDGERLY_ACCESS_TOKEN_TTL_SECONDS:-900}"; refresh_days="${LEDGERLY_REFRESH_TOKEN_TTL_DAYS:-30}"
  [[ "$rate_max" =~ ^[0-9]+$ ]] && (( rate_max > 0 )) || { echo "  production rate limit must be positive"; secret_bad=1; }
  [[ "$access_ttl" =~ ^[0-9]+$ ]] && (( access_ttl >= 60 && access_ttl <= 3600 )) || { echo "  production access token TTL must be 60..3600 seconds"; secret_bad=1; }
  [[ "$refresh_days" =~ ^[0-9]+$ ]] && (( refresh_days >= 1 && refresh_days <= 90 )) || { echo "  production refresh token TTL must be 1..90 days"; secret_bad=1; }
  for image_var in POSTGRES_IMAGE REDIS_IMAGE MINIO_IMAGE MINIO_MC_IMAGE CADDY_IMAGE MEDIAMTX_IMAGE NODE_BASE_IMAGE PGBOUNCER_BASE_IMAGE; do
    image_value="${!image_var:-}"
    [[ "$image_value" == *@sha256:* ]] || { echo "  production requires immutable digest in $image_var"; secret_bad=1; }
  done
  if grep -Eq 'webrtcAllowOrigins:[[:space:]]*\["\*"\]' "$LEDGERLY_REPO_ROOT/camera-server/mediamtx.yml"; then
    echo "  production MediaMTX must restrict webrtcAllowOrigins to the Ledgerly origin"; secret_bad=1
  fi
  [[ -n "${RESTIC_REPOSITORY:-}" ]] || { echo "  production requires encrypted off-site RESTIC_REPOSITORY"; secret_bad=1; }
  [[ -n "${RESTIC_PASSWORD_FILE:-}" && "${RESTIC_PASSWORD_FILE:-}" = /* && -r "${RESTIC_PASSWORD_FILE:-/nonexistent}" ]] || { echo "  production requires an absolute readable RESTIC_PASSWORD_FILE"; secret_bad=1; }
  if [[ -n "${RESTIC_PASSWORD_FILE:-}" && "${RESTIC_PASSWORD_FILE:-}" == "$BACKUP_ROOT"/* ]]; then echo "  RESTIC_PASSWORD_FILE must live outside BACKUP_ROOT"; secret_bad=1; fi
  [[ "${RESTORE_TEST_REQUIRED:-false}" == "true" ]] || { echo "  production requires RESTORE_TEST_REQUIRED=true"; secret_bad=1; }
fi
(( secret_bad == 0 )) && PASS "secret/session/least-privilege/immutable-image/off-site gate" || FAIL "secret/session/least-privilege/immutable-image/off-site gate"

if grep -Fq 'minio-bootstrap:' "$LEDGERLY_COMPOSE_FILE" && grep -Fq 'ledgerly-app-policy.json' "$LEDGERLY_COMPOSE_FILE" && grep -Fq 'MINIO_APP_ACCESS_KEY' "$LEDGERLY_COMPOSE_FILE" && grep -Fq 'cap_drop: ["ALL"]' "$LEDGERLY_COMPOSE_FILE"; then PASS "bucket-scoped MinIO application bootstrap"; else FAIL "bucket-scoped MinIO application bootstrap"; fi
grep -Eq '^USER ledgerly$' "$LEDGERLY_REPO_ROOT/selfhost/pgbouncer/Dockerfile" && PASS "PgBouncer runs unprivileged" || FAIL "PgBouncer runs unprivileged"

if OPS_SKIP_DB_DIAGNOSTICS=true "$LEDGERLY_REPO_ROOT/selfhost/ops/performance-audit.sh" >/tmp/ledgerly-perf-audit.$$ 2>&1; then PASS "database pool bounds"; else cat /tmp/ledgerly-perf-audit.$$; FAIL "database pool bounds"; fi
rm -f /tmp/ledgerly-perf-audit.$$

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if BACKUP_ROOT="$tmp" BACKUP_MIN_FREE_BYTES=9223372036854775807 bash -c 'source "$1"; preflight_disk' _ "$LEDGERLY_REPO_ROOT/selfhost/backups/common.sh" >/dev/null 2>&1; then FAIL "backup disk-full safeguard"; else PASS "backup disk-full safeguard"; fi

if [[ "${RESTORE_TEST_REQUIRED:-false}" == "true" ]]; then
  if [[ -d "$BACKUP_ROOT/status" ]]; then
    if BACKUP_ROOT="$BACKUP_ROOT" RESTORE_TEST_FRESHNESS_SECONDS="${RESTORE_TEST_FRESHNESS_SECONDS:-691200}" "$LEDGERLY_REPO_ROOT/selfhost/backups/check-restore-freshness.sh" >/dev/null; then PASS "recent restore proof"; else FAIL "recent restore proof"; fi
  elif [[ "$production" == true ]]; then FAIL "recent restore proof"; else SKIP "recent restore proof (no target-host state in static validation)"; fi
fi

if check_cmd systemd-analyze; then
  unit_bad=0
  while IFS= read -r -d '' unit; do systemd-analyze verify "$unit" >/dev/null 2>&1 || unit_bad=1; done < <(find "$LEDGERLY_REPO_ROOT/selfhost/systemd" -maxdepth 1 -type f \( -name '*.service' -o -name '*.timer' \) -print0)
  (( unit_bad == 0 )) && PASS "systemd units" || FAIL "systemd units"
else SKIP "systemd unit validation (systemd-analyze unavailable)"; fi

if [[ -n "${OPS_PUBLIC_URL:-}" ]] && check_cmd curl; then
  public_bad=0
  for path in /selfhost/ready /selfhost/contracts /selfhost/ops; do
    code="$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 8 "${OPS_PUBLIC_URL%/}$path" || true)"
    [[ "$code" != 2* && "$code" != 3* ]] || { echo "  public endpoint unexpectedly reachable: $path ($code)"; public_bad=1; }
  done
  (( public_bad == 0 )) && PASS "private admin endpoints inaccessible through public proxy" || FAIL "private admin endpoint exposure"
else SKIP "public-edge private endpoint probe (set OPS_PUBLIC_URL)"; fi

if [[ "${OPS_LIVE_TESTS:-false}" == "true" ]]; then
  if "$LEDGERLY_REPO_ROOT/selfhost/ops/health-check.sh" >/dev/null; then PASS "live service health"; else FAIL "live service health"; fi
  if "$LEDGERLY_REPO_ROOT/selfhost/backups/backup-all.sh" >/dev/null; then PASS "fresh backup generation"; else FAIL "fresh backup generation"; fi
  if [[ -s "$BACKUP_ROOT/status/last-success-set" ]]; then
    latest="$(cat "$BACKUP_ROOT/status/last-success-set")"
    if "$LEDGERLY_REPO_ROOT/selfhost/backups/verify-backup.sh" "$latest" >/dev/null; then PASS "latest backup checksums"; else FAIL "latest backup checksums"; fi
    if [[ "${OPS_DESTRUCTIVE_TESTS:-false}" == "true" ]]; then
      if "$LEDGERLY_REPO_ROOT/selfhost/backups/test-restore.sh" "$latest" >/dev/null; then PASS "scratch restore validation"; else FAIL "scratch restore validation"; fi
    else SKIP "scratch restore validation (set OPS_DESTRUCTIVE_TESTS=true on a rehearsal host)"; fi
  else FAIL "latest backup exists"; fi
  if [[ "${OPS_DESTRUCTIVE_TESTS:-false}" == "true" ]]; then
    if "$LEDGERLY_REPO_ROOT/selfhost/ops/rehearse-restarts.sh" >/dev/null; then PASS "graceful shutdown and reconnect rehearsal"; else FAIL "graceful shutdown and reconnect rehearsal"; fi
  else SKIP "graceful API/Redis/queue reconnect fault injection (destructive tests disabled)"; fi
else
  SKIP "live service health (set OPS_LIVE_TESTS=true on the target host)"
  SKIP "backup checksum/restore live validation (live tests disabled)"
  SKIP "graceful API/Redis/queue reconnect fault injection (live tests disabled)"
  [[ "$production" == false ]] || FAIL "production live validation required (set OPS_LIVE_TESTS=true on the target host)"
fi

printf '\nValidation summary: %s passed, %s failed, %s skipped\n' "$pass" "$fail" "$skip"
(( fail == 0 ))
