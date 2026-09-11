#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
load_runtime_env
ensure_backup_root
SET_FILE="$BACKUP_ROOT/status/last-success-set"
[[ -s "$SET_FILE" ]] || die "no verified backup set is available for restore rehearsal"
SET_ID="$(cat "$SET_FILE")"
export LEDGERLY_TEST_RESTORE_MINIO="${LEDGERLY_TEST_RESTORE_MINIO:-true}"
log "starting disposable restore rehearsal for backup set $SET_ID"
RESULT="$("$(dirname "$0")/test-restore.sh" "$SET_ID")"
printf '%s\n' "$SET_ID" | atomic_write "$BACKUP_ROOT/status/last-restore-test-set"
printf '%s\n' "$(date +%s)" | atomic_write "$BACKUP_ROOT/status/last-restore-test-epoch"
printf '%s\n' "$RESULT" | atomic_write "$BACKUP_ROOT/status/last-restore-test.json"
log "restore rehearsal passed for backup set $SET_ID"
printf '%s\n' "$RESULT"
