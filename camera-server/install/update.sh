#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="${1:-/opt/ledgerly-camera/source}"
SERVER_DIR="$REPO_DIR/camera-server"
if [[ ! -d "$REPO_DIR/.git" ]]; then echo "[camera-update] $REPO_DIR is not a Git checkout; skipping"; exit 0; fi
if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then echo "[camera-update] checkout has local changes; refusing automatic update" >&2; exit 2; fi
git -C "$REPO_DIR" fetch --quiet origin main
CURRENT="$(git -C "$REPO_DIR" rev-parse HEAD)"; TARGET="$(git -C "$REPO_DIR" rev-parse origin/main)"
if [[ "$CURRENT" == "$TARGET" ]]; then echo "[camera-update] already current"; exit 0; fi
git -C "$REPO_DIR" merge-base --is-ancestor "$CURRENT" "$TARGET" || { echo "[camera-update] origin/main is not a fast-forward" >&2; exit 3; }
git -C "$REPO_DIR" pull --ff-only origin main
cd "$SERVER_DIR"
npm install --omit=dev --ignore-scripts
docker compose pull
docker compose up -d
systemctl restart ledgerly-camera.service
echo "[camera-update] updated $CURRENT -> $TARGET"
