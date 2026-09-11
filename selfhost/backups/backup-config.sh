#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
require_cmd tar; require_cmd sha256sum
preflight_disk
SET_ID="${BACKUP_SET_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="$BACKUP_ROOT/config/ledgerly-config-$SET_ID.tar.gz"; PARTIAL="$OUT.partial.$$"
trap 'rm -f "$PARTIAL"' EXIT
SAFE_PATHS=(
  compose.selfhost.yml
  compose.finance-runtime.yml
  .env.selfhost.example
  selfhost/caddy
  selfhost/pgbouncer
  selfhost/redis
  selfhost/postgres/init
  selfhost/backups
  selfhost/ops
  selfhost/systemd
  camera-server/mediamtx.yml
  camera-server/docker-compose.yml
  camera-server/BACKUP_DR.md
)
for p in "${SAFE_PATHS[@]}"; do [[ -e "$LEDGERLY_REPO_ROOT/$p" ]] || die "required safe config path missing: $p"; done
# Secrets are deliberately excluded. Never add .env.selfhost, /etc/ledgerly,
# private keys, credential files, or Restic passwords to SAFE_PATHS.
tar -czf "$PARTIAL" -C "$LEDGERLY_REPO_ROOT" -- "${SAFE_PATHS[@]}"
if tar -tzf "$PARTIAL" | grep -Eqi '(^|/)\.env\.selfhost$|(^|/)backup\.env$|\.pem$|\.key$|(^|/)(credentials?|secrets?)(/|$)|restic-password'; then
  die "unsafe secret-like file detected in config archive"
fi
chmod 0600 "$PARTIAL"; mv "$PARTIAL" "$OUT"; trap - EXIT
SHA="$(sha256_of "$OUT")"; SIZE="$(size_of "$OUT")"
printf '%s  %s\n' "$SHA" "$(basename "$OUT")" >"$OUT.sha256"; chmod 0600 "$OUT.sha256"
cat <<JSON | atomic_write "$OUT.meta.json"
{"kind":"configuration","set_id":"$SET_ID","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","bytes":$SIZE,"sha256":"$SHA","secret_values_included":false,"nvr_configuration_included":true,"catalog_metadata_location":"postgresql","critical_runtime_configuration_included":true}
JSON
printf '%s\n' "$OUT"
