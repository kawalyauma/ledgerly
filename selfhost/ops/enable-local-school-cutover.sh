#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${LEDGERLY_ENV_FILE:-$ROOT_DIR/.env.selfhost}"
COMPOSE_FILE="$ROOT_DIR/compose.selfhost.yml"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
read_env() {
  local key="$1" line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}
set_env() {
  local key="$1" value="$2"
  if grep -q -E "^${key}=" "$ENV_FILE"; then
    sed -i -E "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "docker is required"

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 || fail "Docker is not accessible and sudo is unavailable"
  printf 'Docker requires elevated access; requesting sudo once...\n'
  sudo -v || fail "sudo authentication failed"
  sudo docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"
  DOCKER=(sudo docker)
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "docker compose is required"

[[ "${LEDGERLY_ENVIRONMENT:-$(read_env LEDGERLY_ENVIRONMENT)}" != "production" ]] || fail "This rehearsal script refuses LEDGERLY_ENVIRONMENT=production"
[[ "${LEDGERLY_RUNTIME_MODE:-$(read_env LEDGERLY_RUNTIME_MODE)}" != "production" ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation during School rehearsal"
[[ -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "POSTGRES_PASSWORD is missing"

cd "$ROOT_DIR"
printf 'Building the migration/runtime image...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api migrate-d1

run_schema() {
  local phase="$1"
  printf 'Preparing PostgreSQL phase: %s\n' "$phase"
  "${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 \
    node src/migration/cli.mjs schema --phase "$phase"
}

# School people depends on contacts and mobile-sync core. Schema-only rehearsal is ordered explicitly.
run_schema auth-core
run_schema contacts
run_schema mobile-sync-core
run_schema school-reference
run_schema school-configuration
run_schema school-people

printf 'Validating School PostgreSQL schema and core relationships...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 \
  node src/readiness/school-cutover-check.mjs

printf 'Enabling only the School surfaces implemented and validated in Node...\n'
set_env LEDGERLY_SCHOOL_SELFHOST_ENABLED true
set_env LEDGERLY_SCHOOL_REFERENCE_READ_CUTOVER node
set_env LEDGERLY_SCHOOL_REFERENCE_WRITE_CUTOVER node
set_env LEDGERLY_SCHOOL_PEOPLE_READ_CUTOVER node
set_env LEDGERLY_SCHOOL_PEOPLE_WRITE_CUTOVER cloudflare

printf 'Restarting the self-hosted API...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build api

printf '\nSchool cutover rehearsal completed.\n'
printf '  School setup/reference reads:  Node\n'
printf '  School setup/reference writes: Node\n'
printf '  Student/admission reads:       Node\n'
printf '  Student/admission writes:      Cloudflare (not falsely enabled)\n'
printf '  Runtime mode:                  foundation\n'
printf '\nThis is a local schema rehearsal, not proof that existing Cloudflare D1 School data has been migrated.\n'
printf 'For a real data cutover, run/validate the same migration phases against D1 before changing production authority.\n'
