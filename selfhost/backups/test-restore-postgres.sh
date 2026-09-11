#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 1 ]; then
  echo "usage: test-restore-postgres.sh BACKUP.dump" >&2
  exit 2
fi

BACKUP="$1"
[ -f "$BACKUP" ] || { echo "backup not found: $BACKUP" >&2; exit 2; }
[ -f "$BACKUP.sha256" ] || { echo "checksum missing: $BACKUP.sha256" >&2; exit 2; }

TEST_DB="${LEDGERLY_TEST_RESTORE_DATABASE:-ledgerly_restore_test_$(date -u +%Y%m%dT%H%M%SZ)}"
SOURCE_DB="${PGDATABASE:-ledgerly}"
MAINTENANCE_DB="${PGMAINTENANCE_DB:-postgres}"
KEEP_DB="${LEDGERLY_TEST_RESTORE_KEEP_DATABASE:-0}"
CHECKS_FILE="$(mktemp)"

case "$TEST_DB" in
  ledgerly_restore_test_*) ;;
  *)
    echo "refusing restore drill: LEDGERLY_TEST_RESTORE_DATABASE must begin with ledgerly_restore_test_" >&2
    exit 2
    ;;
esac

[ "$TEST_DB" != "$SOURCE_DB" ] || { echo "refusing restore drill into source database $SOURCE_DB" >&2; exit 2; }

BACKUP_DIR="$(cd "$(dirname "$BACKUP")" && pwd)"
BACKUP_NAME="$(basename "$BACKUP")"
(cd "$BACKUP_DIR" && sha256sum -c "$BACKUP_NAME.sha256")
pg_restore --list "$BACKUP" >/dev/null

cleanup() {
  rm -f "$CHECKS_FILE"
  if [ "$KEEP_DB" != "1" ]; then
    dropdb --if-exists --maintenance-db="$MAINTENANCE_DB" "$TEST_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

dropdb --if-exists --maintenance-db="$MAINTENANCE_DB" "$TEST_DB" >/dev/null
createdb --maintenance-db="$MAINTENANCE_DB" "$TEST_DB"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TEST_DB" "$BACKUP"

ACTUAL_DB="$(PGDATABASE="$TEST_DB" psql -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database()')"
[ "$ACTUAL_DB" = "$TEST_DB" ] || { echo "restore connected to unexpected database: $ACTUAL_DB" >&2; exit 1; }
printf '%s\n' "database-name-ok" >> "$CHECKS_FILE"

for TABLE in public.organizations public.users ledgerly_meta.migration_runs; do
  EXISTS="$(PGDATABASE="$TEST_DB" psql -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('$TABLE') IS NOT NULL")"
  [ "$EXISTS" = "t" ] || { echo "required restored table missing: $TABLE" >&2; exit 1; }
  printf '%s\n' "table-ok:$TABLE" >> "$CHECKS_FILE"
done

ORG_COUNT="$(PGDATABASE="$TEST_DB" psql -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM organizations')"
USER_COUNT="$(PGDATABASE="$TEST_DB" psql -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM users')"
printf '%s\n' "organization-count=$ORG_COUNT" "user-count=$USER_COUNT" >> "$CHECKS_FILE"

printf '{"ok":true,"backup":"%s","testDatabase":"%s","kept":%s,"checks":[' "$BACKUP" "$TEST_DB" "$( [ "$KEEP_DB" = "1" ] && echo true || echo false )"
awk 'BEGIN{first=1}{gsub(/\\/,"\\\\");gsub(/\"/,"\\\"");if(!first)printf ",";printf "\"%s\"",$0;first=0}END{print "]}"}' "$CHECKS_FILE"
