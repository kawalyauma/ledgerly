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
[[ -d "$OBJ" && -f "$OBJ/SHA256SUMS" && -f "$OBJ/meta.json" ]] || die "object backup set is incomplete"
( cd "$OBJ" && sha256sum -c SHA256SUMS >/dev/null )
[[ -s "$CFG" && -f "$CFG.sha256" && -f "$CFG.meta.json" ]] || die "configuration backup set is incomplete"
( cd "$(dirname "$CFG")" && sha256sum -c "$(basename "$CFG").sha256" >/dev/null )
for meta in "$PG.meta.json" "$OBJ/meta.json" "$CFG.meta.json"; do grep -q '"validated":true\|"checksums_verified":true\|"secret_values_included":false' "$meta" || die "metadata validation marker missing: $meta"; done
printf '{"set_id":"%s","verified_at":"%s","status":"valid"}\n' "$SET_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
