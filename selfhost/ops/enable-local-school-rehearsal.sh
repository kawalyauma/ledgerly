#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${LEDGERLY_ENV_FILE:-$ROOT_DIR/.env.selfhost}"
COMPOSE_FILE="$ROOT_DIR/compose.selfhost.yml"

fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
read_env(){ local key="$1" line; line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"; printf '%s' "${line#*=}"; }
set_env(){ local key="$1" value="$2"; if grep -q -E "^${key}=" "$ENV_FILE"; then sed -i -E "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"; else printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi; }

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "docker is required"
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 || fail "Docker is not accessible and sudo is unavailable"
  printf 'Docker requires elevated access; requesting sudo once...\n'
  sudo -v || fail "sudo authentication failed"
  sudo docker info >/dev/null 2>&1 || fail "Docker daemon is not accessible even with sudo"
  DOCKER=(sudo docker)
fi

[[ "$(read_env LEDGERLY_ENVIRONMENT)" != "production" ]] || fail "School rehearsal refuses LEDGERLY_ENVIRONMENT=production"
[[ "$(read_env LEDGERLY_RUNTIME_MODE)" != "production" ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation during rehearsal"
[[ -n "$(read_env LEDGERLY_DATABASE_PASSWORD)" || -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "Database password is missing"

cd "$ROOT_DIR"
printf 'Building the migration/API image...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api migrate-d1

printf 'Applying School Management PostgreSQL schemas...\n'
for phase in school-configuration school-people school-staff; do
  printf '  - %s\n' "$phase"
  "${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 \
    node src/migration/cli.mjs schema --phase "$phase"
done

POSTGRES_USER_VALUE="$(read_env POSTGRES_USER)"; POSTGRES_USER_VALUE="${POSTGRES_USER_VALUE:-ledgerly}"
POSTGRES_DB_VALUE="$(read_env POSTGRES_DB)"; POSTGRES_DB_VALUE="${POSTGRES_DB_VALUE:-ledgerly}"
printf 'Validating required school tables in PostgreSQL...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -Atc \
  "SELECT CASE WHEN COUNT(*)=15 THEN 'school-schema-ok' ELSE (1/0)::text END FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('school_profiles','school_branches','school_academic_years','school_terms','school_class_levels','school_classes','school_streams','school_subjects','school_class_subjects','school_grading_scales','school_roles','school_students','school_guardians','school_staff_profiles','school_settings');"

printf 'Exercising the School setup service against PostgreSQL before changing authority...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 \
  node src/school-platform/validate-setup-cutover.mjs

printf 'School schema/service validation passed. Enabling ONLY the School setup/reference Node surface...\n'
set_env LEDGERLY_SCHOOL_SELFHOST_ENABLED true
set_env LEDGERLY_SCHOOL_SETUP_CUTOVER node

printf 'Restarting API...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build api

printf '\nSchool PostgreSQL rehearsal stage 1 is enabled.\n'
printf 'Enabled: school profile, academic/reference setup, grading/configuration, settings, bootstrap/defaults and term close.\n'
printf 'Prepared but NOT YET cut over: students/admissions, staff, IAM, promotion/discipline, files and fees.\n'
printf 'Runtime remains foundation and all non-school cutovers remain unchanged.\n'
