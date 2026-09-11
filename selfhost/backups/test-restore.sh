#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 1 ]] || die "usage: test-restore.sh SET_ID"
SET_ID="$1"; require_cmd docker; load_runtime_env
"$(dirname "$0")/verify-backup.sh" "$SET_ID" >/dev/null
PG="$BACKUP_ROOT/postgres/ledgerly-$SET_ID.dump"
SCRATCH="${LEDGERLY_TEST_RESTORE_DATABASE:-ledgerly_restore_test_${SET_ID//[^a-zA-Z0-9]/_}}"
[[ "$SCRATCH" != "$POSTGRES_DB" ]] || die "test restore database must not be the production database"
cleanup(){ compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
cleanup
compose exec -T postgres createdb -U "$POSTGRES_USER" "$SCRATCH"
compose exec -T postgres pg_restore -U "$POSTGRES_USER" --no-owner --no-acl --exit-on-error --dbname="$SCRATCH" <"$PG"
RELATIONS="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$SCRATCH" -Atv ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema');")"
[[ "$RELATIONS" =~ ^[0-9]+$ ]] && (( RELATIONS > 0 )) || die "scratch restore has no application relations"
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$SCRATCH" -v ON_ERROR_STOP=1 -c 'ANALYZE;' >/dev/null
OBJECT_TEST="checksums_only"
if [[ "${LEDGERLY_TEST_RESTORE_MINIO:-false}" == "true" ]]; then
  SRC="$BACKUP_ROOT/objects/$SET_ID"; MINIO_CID="$(compose ps -q minio)"; TEST_BUCKET="ledgerly-restore-test-${SET_ID,,}"
  TEST_BUCKET="${TEST_BUCKET//[^a-z0-9-]/-}"; TEST_BUCKET="${TEST_BUCKET:0:63}"
  docker run --rm --network "container:$MINIO_CID" --user "$(id -u):$(id -g)" -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e TEST_BUCKET \
    -v "$SRC:/backup:ro" --entrypoint /bin/sh minio/mc:latest -ec '
      export MC_CONFIG_DIR=/tmp/.mc; mc alias set target http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
      mc mb --ignore-existing "target/$TEST_BUCKET" >/dev/null
      trap "mc rb --force target/$TEST_BUCKET >/dev/null 2>&1 || true" EXIT
      mc mirror --overwrite --exclude SHA256SUMS --exclude meta.json /backup "target/$TEST_BUCKET"
      mc ls --recursive "target/$TEST_BUCKET" >/dev/null
    '
  OBJECT_TEST="scratch_bucket"
fi
printf '{"status":"restore_test_passed","set_id":"%s","database_relations":%s,"objects":"%s","production_mutated":false}\n' "$SET_ID" "$RELATIONS" "$OBJECT_TEST"
