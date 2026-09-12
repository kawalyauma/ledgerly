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
if ! docker info >/dev/null 2>&1; then command -v sudo >/dev/null 2>&1 || fail "Docker is not accessible and sudo is unavailable"; sudo -v || fail "sudo authentication failed"; DOCKER=(sudo docker); fi
[[ "${LEDGERLY_ENVIRONMENT:-$(read_env LEDGERLY_ENVIRONMENT)}" != production ]] || fail "This rehearsal refuses production"
cd "$ROOT_DIR"
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api migrate-d1
run_schema(){ printf 'Preparing PostgreSQL phase: %s\n' "$1"; "${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 node src/migration/cli.mjs schema --phase "$1"; }
run_schema auth-core
run_schema contacts
run_schema mobile-sync-core
run_schema communications
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 node src/readiness/communications-cutover-check.mjs
set_env LEDGERLY_COMMUNICATIONS_SELFHOST_ENABLED true
set_env SELFHOST_COMMUNICATIONS_ENABLED true
set_env LEDGERLY_COMMUNICATIONS_CUTOVER node
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build api
printf '\nCommunications cutover rehearsal completed.\n'
printf '  API authority: Node\n'
printf '  PostgreSQL campaigns/deliveries/preferences: enabled\n'
printf '  Redis delivery worker + scheduler: enabled\n'
printf '  SMS/WhatsApp delivery: only active when provider credentials are configured\n'
