#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
require_cmd sha256sum
[[ $# -eq 1 ]] || die "usage: verify-backup.sh SET_ID"
SET_ID="$1"
PG="$BACKUP_ROOT/postgres/ledgerly-$SET_ID.dump"
OBJ="$BACKUP_ROOT/objects/$SET_ID"
CFG="$BACKUP_ROOT/config/ledgerly-config-$SET_ID.tar.gz"
[[ -s "$PG" && -f "$PG.sha256" && -f "$PG.meta.json" ]] || die "PostgreSQL backup set is incomplete"
( cd "$(dirname "$PG")" && sha256sum -c "$(basename "$PG").sha256" >/dev/null )
grep -Fq "\"set_id\":\"$SET_ID\"" "$PG.meta.json" || die "PostgreSQL metadata set id mismatch"
grep -Fq '"validated":true' "$PG.meta.json" || die "PostgreSQL metadata validation marker missing"

[[ -d "$OBJ" && -f "$OBJ/SHA256SUMS" && -f "$OBJ/meta.json" ]] || die "object backup set is incomplete"
( cd "$OBJ" && sha256sum -c SHA256SUMS >/dev/null )
grep -Fq "\"set_id\":\"$SET_ID\"" "$OBJ/meta.json" || die "object metadata set id mismatch"
grep -Fq '"checksums_verified":true' "$OBJ/meta.json" || die "object metadata validation marker missing"

[[ -s "$CFG" && -f "$CFG.sha256" && -f "$CFG.meta.json" ]] || die "configuration backup set is incomplete"
( cd "$(dirname "$CFG")" && sha256sum -c "$(basename "$CFG").sha256" >/dev/null )
grep -Fq "\"set_id\":\"$SET_ID\"" "$CFG.meta.json" || die "configuration metadata set id mismatch"
grep -Fq '"secret_values_included":false' "$CFG.meta.json" || die "configuration backup secret-safety marker missing"

printf '{"set_id":"%s","verified_at":"%s","status":"valid"}\n' "$SET_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
