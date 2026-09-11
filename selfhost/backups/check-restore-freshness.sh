#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ensure_backup_root
NOW="$(date +%s)"
MAX_AGE="${RESTORE_TEST_FRESHNESS_SECONDS:-691200}"
EPOCH_FILE="$BACKUP_ROOT/status/last-restore-test-epoch"
SET_FILE="$BACKUP_ROOT/status/last-restore-test-set"
[[ "$MAX_AGE" =~ ^[0-9]+$ ]] || die "RESTORE_TEST_FRESHNESS_SECONDS must be an integer"
if [[ ! -s "$EPOCH_FILE" || ! -s "$SET_FILE" ]]; then
  printf '{"status":"missing","ok":false,"age_seconds":null,"max_age_seconds":%s}\n' "$MAX_AGE"
  exit 2
fi
EPOCH="$(cat "$EPOCH_FILE")"; SET_ID="$(cat "$SET_FILE")"
[[ "$EPOCH" =~ ^[0-9]+$ ]] || die "invalid restore-test freshness epoch"
AGE=$(( NOW - EPOCH )); (( AGE >= 0 )) || AGE=0
if (( AGE > MAX_AGE )); then
  printf '{"status":"stale","ok":false,"set_id":"%s","age_seconds":%s,"max_age_seconds":%s}\n' "$SET_ID" "$AGE" "$MAX_AGE"
  exit 1
fi
printf '{"status":"fresh","ok":true,"set_id":"%s","age_seconds":%s,"max_age_seconds":%s}\n' "$SET_ID" "$AGE" "$MAX_AGE"
