#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
require_cmd docker; require_cmd sha256sum; require_cmd tar
load_runtime_env; preflight_disk; acquire_backup_lock
SET_ID="${BACKUP_SET_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"; export BACKUP_SET_ID="$SET_ID"
log "starting Ledgerly backup set $SET_ID"
PG_PATH="$("$(dirname "$0")/backup-postgres.sh")"
OBJ_PATH="$("$(dirname "$0")/backup-objects.sh")"
CFG_PATH="$("$(dirname "$0")/backup-config.sh")"
VERIFY_JSON="$("$(dirname "$0")/verify-backup.sh" "$SET_ID")"
OFFSITE_STATUS="not_configured"; RESTIC_SNAPSHOT=""
if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  require_cmd restic
  : "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required when RESTIC_REPOSITORY is set}"
  [[ -r "$RESTIC_PASSWORD_FILE" ]] || die "restic password file is not readable"
  [[ "$(stat -c '%a' "$RESTIC_PASSWORD_FILE" 2>/dev/null || true)" =~ ^(400|600|640)$ ]] || die "restic password file permissions are unsafe"
  export RESTIC_PASSWORD_FILE RESTIC_REPOSITORY
  restic snapshots >/dev/null 2>&1 || restic init
  restic backup --tag ledgerly --tag "$SET_ID" "$PG_PATH" "$PG_PATH.sha256" "$PG_PATH.meta.json" "$OBJ_PATH" "$CFG_PATH" "$CFG_PATH.sha256" "$CFG_PATH.meta.json"
  RESTIC_SNAPSHOT="$(restic snapshots --latest 1 --json | sed -n 's/.*"short_id":"\([^"]*\)".*/\1/p' | head -1)"
  restic check --read-data-subset="${RESTIC_CHECK_SUBSET:-5%}"
  restic forget --keep-daily "${RESTIC_KEEP_DAILY:-14}" --keep-weekly "${RESTIC_KEEP_WEEKLY:-8}" --keep-monthly "${RESTIC_KEEP_MONTHLY:-12}" --prune
  OFFSITE_STATUS="verified"
fi
PG_SHA="$(sha256_of "$PG_PATH")"; CFG_SHA="$(sha256_of "$CFG_PATH")"
OBJ_SUMS_SHA="$(sha256_of "$OBJ_PATH/SHA256SUMS")"
MANIFEST="$BACKUP_ROOT/sets/$SET_ID.json"
cat <<JSON | atomic_write "$MANIFEST"
{"format_version":1,"set_id":"$SET_ID","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","status":"valid","postgres":{"path":"${PG_PATH#$BACKUP_ROOT/}","sha256":"$PG_SHA"},"objects":{"path":"${OBJ_PATH#$BACKUP_ROOT/}","sha256_manifest":"$OBJ_SUMS_SHA"},"config":{"path":"${CFG_PATH#$BACKUP_ROOT/}","sha256":"$CFG_SHA","contains_secret_values":false},"nvr":{"configuration_in_config_backup":true,"catalog_metadata_in_postgresql":true,"video_archive_managed_separately":true},"offsite":{"status":"$OFFSITE_STATUS","restic_snapshot":"$RESTIC_SNAPSHOT"},"verification":$VERIFY_JSON}
JSON
printf '%s\n' "$SET_ID" | atomic_write "$BACKUP_ROOT/status/last-success-set"
printf '%s\n' "$(date +%s)" | atomic_write "$BACKUP_ROOT/status/last-success-epoch"
cp "$MANIFEST" "$BACKUP_ROOT/status/last-success.json"; chmod 0600 "$BACKUP_ROOT/status/last-success.json"
prune_local_backups
log "backup set $SET_ID verified successfully"
printf '%s\n' "$MANIFEST"
