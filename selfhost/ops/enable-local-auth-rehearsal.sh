#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${LEDGERLY_ENV_FILE:-$ROOT_DIR/.env.selfhost}"
COMPOSE_FILE="$ROOT_DIR/compose.selfhost.yml"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
read_env() {
  local key="$1"
  local line
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

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE. Copy .env.selfhost.example first and populate its secrets."
command -v docker >/dev/null 2>&1 || fail "docker is required"

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    printf 'Docker requires elevated access; requesting sudo once for this rehearsal...\n'
    sudo -v || fail "sudo authentication failed"
    sudo docker info >/dev/null 2>&1 || fail "Docker daemon is not accessible even with sudo"
    DOCKER=(sudo docker)
  else
    fail "Current user cannot access the Docker daemon and sudo is unavailable"
  fi
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "docker compose is required"

ENVIRONMENT="$(read_env LEDGERLY_ENVIRONMENT)"
RUNTIME_MODE="$(read_env LEDGERLY_RUNTIME_MODE)"
[[ "${ENVIRONMENT:-development}" != "production" ]] || fail "Local auth rehearsal refuses LEDGERLY_ENVIRONMENT=production"
[[ "${RUNTIME_MODE:-foundation}" != "production" ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation for rehearsal"
[[ -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "POSTGRES_PASSWORD is missing"
[[ -n "$(read_env LEDGERLY_JWT_SECRET)" ]] || fail "LEDGERLY_JWT_SECRET is missing"

printf 'Preparing auth/core PostgreSQL schema (no Cloudflare credentials are used)...\n'
cd "$ROOT_DIR"
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api migrate-d1
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs schema --phase auth-core

printf 'Enabling Node auth login + registration for this local rehearsal...\n'
set_env LEDGERLY_AUTH_LOGIN_CUTOVER node
set_env LEDGERLY_AUTH_REGISTER_CUTOVER node

printf 'Restarting the self-hosted API with the auth route enabled...\n'
"${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build api

printf '\nLocal auth rehearsal is enabled.\n'
printf 'Runtime mode remains foundation; Printerly and other business cutovers were not changed.\n'
printf 'Use the Ledgerly web UI to create a local rehearsal organization, then sign in.\n'
printf 'This schema-only bootstrap is NOT D1 migration validation and is NOT production cutover evidence.\n'
