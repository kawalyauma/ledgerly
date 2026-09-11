#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ensure_backup_root
NOW="$(date +%s)"
EPOCH_FILE="$BACKUP_ROOT/status/last-success-epoch"
SET_FILE="$BACKUP_ROOT/status/last-success-set"
if [[ ! -s "$EPOCH_FILE" || ! -s "$SET_FILE" ]]; then
  printf '{"status":"missing","ok":false,"age_seconds":null,"max_age_seconds":%s}\n' "$BACKUP_FRESHNESS_SECONDS"
  exit 2
fi
EPOCH="$(cat "$EPOCH_FILE")"; SET_ID="$(cat "$SET_FILE")"
[[ "$EPOCH" =~ ^[0-9]+$ ]] || die "invalid backup freshness epoch"
AGE=$(( NOW - EPOCH )); (( AGE >= 0 )) || AGE=0
if (( AGE > BACKUP_FRESHNESS_SECONDS )); then
  printf '{"status":"stale","ok":false,"set_id":"%s","age_seconds":%s,"max_age_seconds":%s}\n' "$SET_ID" "$AGE" "$BACKUP_FRESHNESS_SECONDS"
  exit 1
fi
printf '{"status":"fresh","ok":true,"set_id":"%s","age_seconds":%s,"max_age_seconds":%s}\n' "$SET_ID" "$AGE" "$BACKUP_FRESHNESS_SECONDS"
