#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "usage: restore-postgres.sh BACKUP.dump" >&2; exit 2; fi
BACKUP="$1"
[ -f "$BACKUP" ] || { echo "backup not found: $BACKUP" >&2; exit 2; }
[ -f "$BACKUP.sha256" ] && (cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256")
: "${LEDGERLY_RESTORE_CONFIRM:?Set LEDGERLY_RESTORE_CONFIRM=RESTORE to continue}"
[ "$LEDGERLY_RESTORE_CONFIRM" = "RESTORE" ] || { echo "restore confirmation mismatch" >&2; exit 2; }
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$PGDATABASE" "$BACKUP"
psql -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
