#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${LEDGERLY_ENV_FILE:-$ROOT_DIR/.env.selfhost}"
COMPOSE_FILE="$ROOT_DIR/compose.selfhost.yml"
MODULE_OVERLAY="$ROOT_DIR/selfhost/ops/compose-module-cutovers.yml"
fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
read_env(){ local key="$1" line; line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"; printf '%s' "${line#*=}"; }
set_env(){ local key="$1" value="$2"; if grep -q -E "^${key}=" "$ENV_FILE"; then sed -i -E "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"; else printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi; }
[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
[[ -f "$MODULE_OVERLAY" ]] || fail "Missing $MODULE_OVERLAY"
command -v docker >/dev/null 2>&1 || fail "docker is required"
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then command -v sudo >/dev/null 2>&1 || fail "Docker is not accessible and sudo is unavailable"; printf 'Docker requires elevated access; requesting sudo once...\n'; sudo -v || fail "sudo authentication failed"; DOCKER=(sudo docker); fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "docker compose is required"
[[ "${LEDGERLY_ENVIRONMENT:-$(read_env LEDGERLY_ENVIRONMENT)}" != production ]] || fail "This rehearsal refuses LEDGERLY_ENVIRONMENT=production"
[[ "${LEDGERLY_RUNTIME_MODE:-$(read_env LEDGERLY_RUNTIME_MODE)}" != production ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation during Academics rehearsal"
[[ -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "POSTGRES_PASSWORD is missing"
cd "$ROOT_DIR"
COMPOSE=("${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$MODULE_OVERLAY")
printf 'Building migration/runtime images...\n'
"${COMPOSE[@]}" build api migrate-d1
run_schema(){ local phase="$1"; printf 'Preparing PostgreSQL phase: %s\n' "$phase"; "${COMPOSE[@]}" --profile migration run --rm migrate-d1 node src/migration/cli.mjs schema --phase "$phase"; }
run_schema auth-core
run_schema module-registry
run_schema contacts
run_schema mobile-sync-core
run_schema school-reference
run_schema school-configuration
run_schema school-people
run_schema school-staff
run_schema attendance
run_schema academics
printf 'Validating Academics schema, relationships, Attendance linkage and mobile bridge...\n'
"${COMPOSE[@]}" --profile migration run --rm migrate-d1 node src/readiness/academics-cutover-check.mjs
printf 'Enabling PostgreSQL module registry, Academics authority and shared mobile sync...\n'
set_env LEDGERLY_PLATFORM_MODULES_SELFHOST_ENABLED true
set_env LEDGERLY_PLATFORM_MODULES_CUTOVER node
set_env SELFHOST_MOBILE_SYNC_ENABLED true
set_env LEDGERLY_ACADEMICS_SELFHOST_ENABLED true
set_env SELFHOST_ACADEMICS_ENABLED true
set_env LEDGERLY_ACADEMICS_CUTOVER node
printf 'Restarting the self-hosted API...\n'
"${COMPOSE[@]}" up -d --build api
printf 'Verifying live Academics and mobile-sync runtime wiring...\n'
"${COMPOSE[@]}" exec -T api node src/readiness/academics-runtime-check.mjs
printf '\nAcademics cutover rehearsal completed.\n'
printf '  Module registry:              Node/PostgreSQL\n'
printf '  Academics API authority:      Node/PostgreSQL\n'
printf '  Mobile sync transport:        PostgreSQL / enabled\n'
printf '  Academics mobile collections: 8 verified\n'
printf '  Timetables + allocations:     enabled\n'
printf '  Schemes + lesson plans:       enabled\n'
printf '  Delivery + Attendance link:   enabled\n'
printf '  Supervision + inspections:    enabled\n'
printf '  Exams:                        untouched / separate module\n'
printf '  Runtime mode:                 foundation\n'
printf '  Organization enablement:      preserved; enable School Management then Academics per organization\n'
printf '\nThis is a local schema/runtime rehearsal, not proof that existing Cloudflare D1 Academics data has been migrated.\n'
printf 'For production cutover, migrate and validate the Academics phase against D1 before moving authority.\n'
