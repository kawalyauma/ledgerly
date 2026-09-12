#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${LEDGERLY_ENV_FILE:-$ROOT_DIR/.env.selfhost}"
BASE_COMPOSE="$ROOT_DIR/compose.selfhost.yml"
CUTOVER_COMPOSE="$ROOT_DIR/compose.selfhost.cutover.yml"

fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
read_env(){ local key="$1" line; line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"; printf '%s' "${line#*=}"; }
set_env(){ local key="$1" value="$2"; if grep -q -E "^${key}=" "$ENV_FILE"; then sed -i -E "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"; else printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi; }

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
[[ -f "$CUTOVER_COMPOSE" ]] || fail "Missing $CUTOVER_COMPOSE"
command -v docker >/dev/null 2>&1 || fail "docker is required"
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then command -v sudo >/dev/null 2>&1 || fail "Docker is not accessible and sudo is unavailable"; sudo -v || fail "sudo authentication failed"; sudo docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"; DOCKER=(sudo docker); fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "docker compose is required"
[[ "${LEDGERLY_ENVIRONMENT:-$(read_env LEDGERLY_ENVIRONMENT)}" != "production" ]] || fail "This rehearsal helper refuses LEDGERLY_ENVIRONMENT=production"
[[ "${LEDGERLY_RUNTIME_MODE:-$(read_env LEDGERLY_RUNTIME_MODE)}" != "production" ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation during module rehearsal"
[[ -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "POSTGRES_PASSWORD is missing"

cd "$ROOT_DIR"
COMPOSE=("${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$CUTOVER_COMPOSE")
printf 'Building migration/runtime image...\n'
"${COMPOSE[@]}" build api migrate-d1

for phase in auth-core module-registry contacts mobile-sync-core tasks-work; do
  printf 'Preparing PostgreSQL phase: %s\n' "$phase"
  "${COMPOSE[@]}" --profile migration run --rm migrate-d1 node src/migration/cli.mjs schema --phase "$phase"
done

printf 'Validating Tasks & Work PostgreSQL schema and tenant relationships...\n'
"${COMPOSE[@]}" --profile migration run --rm migrate-d1 node src/readiness/tasks-work-cutover-check.mjs

set_env LEDGERLY_TASKS_WORK_SELFHOST_ENABLED true
set_env LEDGERLY_TASKS_WORK_CUTOVER node
# The inbound WhatsApp webhook remains Cloudflare-authoritative until callback signature/hub parity is rehearsed.
set_env LEDGERLY_TASKS_WORK_WEBHOOK_CUTOVER cloudflare

printf 'Restarting self-hosted API...\n'
"${COMPOSE[@]}" up -d --build api

printf '\nTasks & Work cutover rehearsal completed.\n'
printf '  Private Tasks & Work API: Node\n'
printf '  Reminders/notifications:   Node\n'
printf '  WhatsApp inbound webhook:  Cloudflare\n'
printf '  Runtime mode:              foundation\n'
printf '\nOptional module access still respects organization_modules; enable Tasks & Work for the organization through the Modules UI/API.\n'
printf 'This is schema/runtime rehearsal only; existing Cloudflare Tasks & Work rows still require D1 -> PostgreSQL migration validation.\n'
