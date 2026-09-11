#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGERLY_REPO_ROOT="${LEDGERLY_REPO_ROOT:-$(cd "$OPS_DIR/../.." && pwd)}"
LEDGERLY_COMPOSE_FILE="${LEDGERLY_COMPOSE_FILE:-$LEDGERLY_REPO_ROOT/compose.selfhost.yml}"
LEDGERLY_FINANCE_COMPOSE_FILE="${LEDGERLY_FINANCE_COMPOSE_FILE:-$LEDGERLY_REPO_ROOT/compose.finance-runtime.yml}"
LEDGERLY_ENV_FILE="${LEDGERLY_ENV_FILE:-/etc/ledgerly/ledgerly.env}"
LEDGERLY_BACKUP_ENV_FILE="${LEDGERLY_BACKUP_ENV_FILE:-/etc/ledgerly/backup.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/ledgerly}"

ops_log(){ printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
ops_die(){ ops_log "ERROR: $*"; exit 1; }
ops_require(){ command -v "$1" >/dev/null 2>&1 || ops_die "required command not found: $1"; }

ops_safe_source(){
  local file="$1" mode
  [[ -r "$file" ]] || return 1
  mode="$(stat -c '%a' "$file" 2>/dev/null || true)"
  case "$mode" in 400|440|600|640) ;;
    *) ops_die "refusing to source $file with unsafe permissions ($mode); expected 400/440/600/640" ;;
  esac
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

ops_load_env(){
  if ! ops_safe_source "$LEDGERLY_ENV_FILE"; then
    if [[ "$LEDGERLY_ENV_FILE" == "/etc/ledgerly/ledgerly.env" && -r "$LEDGERLY_REPO_ROOT/.env.selfhost" ]]; then
      LEDGERLY_ENV_FILE="$LEDGERLY_REPO_ROOT/.env.selfhost"
      ops_safe_source "$LEDGERLY_ENV_FILE" || ops_die "could not load runtime environment"
    else
      ops_die "runtime environment file is not readable: $LEDGERLY_ENV_FILE"
    fi
  fi
  [[ -r "$LEDGERLY_BACKUP_ENV_FILE" ]] && ops_safe_source "$LEDGERLY_BACKUP_ENV_FILE" || true
  : "${POSTGRES_DB:?POSTGRES_DB is required}"
  : "${POSTGRES_USER:?POSTGRES_USER is required}"
  : "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
  : "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
  : "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
  BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/ledgerly}"
}

ops_compose(){
  local args=(--env-file "$LEDGERLY_ENV_FILE" -f "$LEDGERLY_COMPOSE_FILE")
  if [[ "${OPS_INCLUDE_FINANCE_RUNTIME:-true}" == "true" && -f "$LEDGERLY_FINANCE_COMPOSE_FILE" ]]; then
    args+=(-f "$LEDGERLY_FINANCE_COMPOSE_FILE")
  fi
  docker compose "${args[@]}" "$@"
}

ops_api_url(){ printf 'http://127.0.0.1:%s' "${LEDGERLY_API_PORT:-8788}"; }
ops_minio_url(){ printf 'http://127.0.0.1:%s' "${MINIO_API_HOST_PORT:-9000}"; }

ops_tcp_check(){
  local host="$1" port="$2"
  timeout 3 bash -c "</dev/tcp/${host}/${port}" >/dev/null 2>&1
}

ops_heading(){ printf '\n== %s ==\n' "$*"; }
