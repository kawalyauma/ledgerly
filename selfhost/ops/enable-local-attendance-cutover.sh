#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${LEDGERLY_ENV_FILE:-$ROOT_DIR/.env.selfhost}"
COMPOSE_FILE="$ROOT_DIR/compose.selfhost.yml"
MODULE_OVERLAY="$ROOT_DIR/selfhost/ops/compose-module-cutovers.yml"
fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
read_env(){ local key="$1" line; line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"; printf '%s' "${line#*=}"; }
set_env(){ local key="$1" value="$2"; if grep -q -E "^${key}=" "$ENV_FILE"; then sed -i -E "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"; else printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi; }
[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
[[ -f "$MODULE_OVERLAY" ]] || fail "Missing $MODULE_OVERLAY"
command -v docker >/dev/null 2>&1 || fail "docker is required"
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then command -v sudo >/dev/null 2>&1 || fail "Docker is not accessible and sudo is unavailable"; sudo -v || fail "sudo authentication failed"; DOCKER=(sudo docker); fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "docker compose is required"
[[ "${LEDGERLY_ENVIRONMENT:-$(read_env LEDGERLY_ENVIRONMENT)}" != production ]] || fail "This rehearsal refuses production"
[[ "${LEDGERLY_RUNTIME_MODE:-$(read_env LEDGERLY_RUNTIME_MODE)}" != production ]] || fail "Keep LEDGERLY_RUNTIME_MODE=foundation during Attendance rehearsal"
[[ -n "$(read_env POSTGRES_PASSWORD)" ]] || fail "POSTGRES_PASSWORD is missing"
cd "$ROOT_DIR"
COMPOSE=("${DOCKER[@]}" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$MODULE_OVERLAY")
"${COMPOSE[@]}" build api migrate-d1
run_schema(){ printf 'Preparing PostgreSQL phase: %s\n' "$1"; "${COMPOSE[@]}" --profile migration run --rm migrate-d1 node src/migration/cli.mjs schema --phase "$1"; }
run_schema auth-core
run_schema module-registry
run_schema contacts
run_schema mobile-sync-core
run_schema school-reference
run_schema school-configuration
run_schema school-people
run_schema school-staff
run_schema attendance
"${COMPOSE[@]}" --profile migration run --rm migrate-d1 node src/readiness/attendance-cutover-check.mjs
if [[ -z "$(read_env BIOMETRIC_ENCRYPTION_KEY)" ]]; then
  command -v python3 >/dev/null 2>&1 || fail "python3 is required to generate the local biometric encryption key"
  BIOMETRIC_KEY="$(python3 - <<'PY'
import base64,secrets
print(base64.b64encode(secrets.token_bytes(32)).decode())
PY
)"
  set_env BIOMETRIC_ENCRYPTION_KEY "$BIOMETRIC_KEY"
  printf 'Generated a local 32-byte biometric encryption key. Keep .env.selfhost private.\n'
fi
set_env LEDGERLY_PLATFORM_MODULES_SELFHOST_ENABLED true
set_env LEDGERLY_PLATFORM_MODULES_CUTOVER node
set_env LEDGERLY_ATTENDANCE_SELFHOST_ENABLED true
set_env SELFHOST_ATTENDANCE_ENABLED true
set_env LEDGERLY_ATTENDANCE_CUTOVER node
"${COMPOSE[@]}" up -d --build api
printf '\nAttendance cutover rehearsal completed.\n'
printf '  Module registry: Node/PostgreSQL\n'
printf '  Attendance API authority: Node\n'
printf '  PostgreSQL sessions/records/events/devices: enabled\n'
printf '  Offline kiosk sync + one-time QR enrollment: enabled\n'
printf '  Face templates: AES-GCM encrypted with the local biometric key\n'
printf '  School Management remains the canonical people/classes source\n'
