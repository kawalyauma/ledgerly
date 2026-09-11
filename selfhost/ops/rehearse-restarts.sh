#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_require docker
ops_require curl
ops_load_env
[[ "${OPS_DESTRUCTIVE_TESTS:-false}" == "true" ]] || ops_die "restart rehearsal is disruptive; set OPS_DESTRUCTIVE_TESTS=true on a rehearsal/staging host"

wait_ready(){
  local deadline=$((SECONDS + ${OPS_RESTART_READY_TIMEOUT_SECONDS:-90}))
  while (( SECONDS < deadline )); do
    if curl --fail --silent --show-error --max-time 5 "$(ops_api_url)/selfhost/ready" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

ops_log "checking baseline readiness"
wait_ready || ops_die "API was not ready before restart rehearsal"

ops_log "testing graceful API shutdown"
api_id="$(ops_compose ps -q api)"
[[ -n "$api_id" ]] || ops_die "API container is not running"
ops_compose stop -t 15 api >/dev/null
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$api_id")"
[[ "$exit_code" == "0" ]] || ops_die "API did not stop gracefully (exit=$exit_code)"
ops_compose start api >/dev/null
wait_ready || ops_die "API did not become ready after graceful restart"

ops_log "testing Redis reconnect and queue/scheduler recovery"
ops_compose restart redis >/dev/null
wait_ready || ops_die "API/queue/scheduler did not recover after Redis restart"

ops_log "testing PgBouncer/database reconnect"
ops_compose restart pgbouncer >/dev/null
wait_ready || ops_die "API did not recover after PgBouncer restart"

ops_log "running full health check after fault injection"
"$LEDGERLY_REPO_ROOT/selfhost/ops/health-check.sh" >/dev/null
ops_log "restart/reconnect rehearsal passed"
