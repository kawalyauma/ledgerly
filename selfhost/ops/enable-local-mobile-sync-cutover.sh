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
  sudo -v || fail "sudo authentication failed"
  sudo docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"
  DOCKER=(sudo docker)
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "docker compose is required"
[[ "${LEDGERLY_ENVIRONMENT:-$(read_env LEDGERLY_ENVIRONMENT)}" != "production" ]] || fail "This rehearsal helper refuses LEDGERLY_ENVIRONMENT=production"
[[ "${LEDGERLY_RUNTIME_MODE:-$(read_env LEDGERLY_RUNTIME_MODE)}" != "production" ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation during module rehearsal"
[[ -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "POSTGRES_PASSWORD is missing"

cd "$ROOT_DIR"
printf 'Building migration/runtime image...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api migrate-d1

for phase in auth-core mobile-sync-core; do
  printf 'Preparing PostgreSQL phase: %s\n' "$phase"
  "${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 node src/migration/cli.mjs schema --phase "$phase"
done

printf 'Validating mobile-sync PostgreSQL schema and relationships...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 node src/readiness/mobile-sync-cutover-check.mjs

set_env LEDGERLY_MOBILE_SYNC_SELFHOST_ENABLED true
set_env LEDGERLY_MOBILE_SYNC_CUTOVER node

printf 'Restarting self-hosted API...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build api

printf '\nMobile Sync cutover rehearsal completed.\n'
printf '  Mobile Sync private API: Node\n'
printf '  Offline grant exchange:  Node\n'
printf '  Runtime mode:            foundation\n'
printf '\nThis validates local PostgreSQL schema/runtime wiring only. Existing Cloudflare mobile-sync data must still be migrated and checked before production authority moves.\n'
