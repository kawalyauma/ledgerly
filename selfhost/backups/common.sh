#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/ledgerly}"
LEDGERLY_REPO_ROOT="${LEDGERLY_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LEDGERLY_ENV_FILE="${LEDGERLY_ENV_FILE:-/etc/ledgerly/ledgerly.env}"
LEDGERLY_COMPOSE_FILE="${LEDGERLY_COMPOSE_FILE:-$LEDGERLY_REPO_ROOT/compose.selfhost.yml}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_FRESHNESS_SECONDS="${BACKUP_FRESHNESS_SECONDS:-93600}"
BACKUP_MIN_FREE_BYTES="${BACKUP_MIN_FREE_BYTES:-5368709120}"

log(){ printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die(){ log "ERROR: $*"; exit 1; }
require_cmd(){ command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

load_runtime_env(){
  [[ -r "$LEDGERLY_ENV_FILE" ]] || die "runtime environment file is not readable: $LEDGERLY_ENV_FILE"
  local mode
  mode="$(stat -c '%a' "$LEDGERLY_ENV_FILE" 2>/dev/null || true)"
  [[ "$mode" == "600" || "$mode" == "400" || "$mode" == "640" ]] || die "refusing secrets file with unsafe mode $mode; expected 600/400/640"
  set -a
  # shellcheck disable=SC1090
  source "$LEDGERLY_ENV_FILE"
  set +a
  : "${POSTGRES_DB:?POSTGRES_DB is required}"
  : "${POSTGRES_USER:?POSTGRES_USER is required}"
  : "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
  : "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
  : "${MINIO_DEFAULT_BUCKET:=ledgerly}"
}

compose(){ docker compose --env-file "$LEDGERLY_ENV_FILE" -f "$LEDGERLY_COMPOSE_FILE" "$@"; }

ensure_backup_root(){
  mkdir -p "$BACKUP_ROOT"/{postgres,objects,config,sets,status}
  chmod 0700 "$BACKUP_ROOT" "$BACKUP_ROOT"/{postgres,objects,config,sets,status}
}

free_bytes(){
  df -Pk "$BACKUP_ROOT" | awk 'NR==2 {printf "%.0f\n", $4*1024}'
}

preflight_disk(){
  ensure_backup_root
  local free
  free="$(free_bytes)"
  [[ "$free" =~ ^[0-9]+$ ]] || die "could not determine free backup bytes"
  (( free >= BACKUP_MIN_FREE_BYTES )) || die "backup disk free space ${free} is below required ${BACKUP_MIN_FREE_BYTES} bytes"
}

sha256_of(){ sha256sum "$1" | awk '{print $1}'; }
size_of(){ stat -c '%s' "$1"; }

atomic_write(){
  local target="$1" tmp
  tmp="${target}.partial.$$"
  cat >"$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$target"
}

acquire_backup_lock(){
  ensure_backup_root
  local lock="$BACKUP_ROOT/.backup.lock"
  if ! mkdir "$lock" 2>/dev/null; then
    die "another backup appears to be running ($lock exists)"
  fi
  printf '%s\n' "$$" >"$lock/pid"
  trap 'rm -rf "$BACKUP_ROOT/.backup.lock"' EXIT INT TERM
}

prune_local_backups(){
  [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_RETENTION_DAYS must be numeric"
  find "$BACKUP_ROOT/postgres" -type f -mtime "+$BACKUP_RETENTION_DAYS" -delete
  find "$BACKUP_ROOT/config" -type f -mtime "+$BACKUP_RETENTION_DAYS" -delete
  find "$BACKUP_ROOT/objects" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_RETENTION_DAYS" -exec rm -rf -- {} +
  find "$BACKUP_ROOT/sets" -type f -mtime "+$BACKUP_RETENTION_DAYS" -delete
}
