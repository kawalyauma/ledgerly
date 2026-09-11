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
  if [ "$KEEP_DB" != "1" ]; then
    dropdb --if-exists --maintenance-db="$MAINTENANCE_DB" "$TEST_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

dropdb --if-exists --maintenance-db="$MAINTENANCE_DB" "$TEST_DB" >/dev/null
createdb --maintenance-db="$MAINTENANCE_DB" "$TEST_DB"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TEST_DB" "$BACKUP"

PGDATABASE="$TEST_DB" psql -v ON_ERROR_STOP=1 -At <<'SQL' >/tmp/ledgerly-restore-checks.txt
SELECT CASE WHEN current_database() LIKE 'ledgerly_restore_test_%' THEN 'database-name-ok' ELSE 1/0::text END;
SELECT CASE WHEN to_regclass('public.organizations') IS NOT NULL THEN 'organizations-table-ok' ELSE 1/0::text END;
SELECT CASE WHEN to_regclass('public.users') IS NOT NULL THEN 'users-table-ok' ELSE 1/0::text END;
SELECT CASE WHEN to_regclass('ledgerly_meta.migration_runs') IS NOT NULL THEN 'migration-metadata-ok' ELSE 1/0::text END;
SELECT 'organization-count=' || count(*) FROM organizations;
SELECT 'user-count=' || count(*) FROM users;
SQL

printf '{"ok":true,"backup":"%s","testDatabase":"%s","kept":%s,"checks":[' "$BACKUP" "$TEST_DB" "$( [ "$KEEP_DB" = "1" ] && echo true || echo false )"
awk 'BEGIN{first=1}{gsub(/\\/,"\\\\");gsub(/\"/,"\\\"");if(!first)printf ",";printf "\"%s\"",$0;first=0}END{print "]}"}' /tmp/ledgerly-restore-checks.txt
rm -f /tmp/ledgerly-restore-checks.txt
