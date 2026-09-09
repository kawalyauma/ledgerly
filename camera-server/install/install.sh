#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run this installer as root." >&2; exit 1; }
for cmd in git node npm docker curl systemctl sed; do command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }; done
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin is required." >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; SOURCE_SERVER="$(cd "$SCRIPT_DIR/.." && pwd)"; REPO_ROOT="$(git -C "$SOURCE_SERVER" rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$REPO_ROOT" ]] || { echo "Run installer from a Ledgerly Git checkout so safe fast-forward updates remain possible." >&2; exit 3; }
INSTALL_ROOT="${LEDGERLY_CAMERA_INSTALL_ROOT:-/opt/ledgerly-camera}"; REPO_INSTALL="$INSTALL_ROOT/source"; SERVER_DIR="$REPO_INSTALL/camera-server"; DATA_ROOT="${LEDGERLY_CAMERA_DATA_ROOT:-/var/lib/ledgerly-camera}"; AUTO_UPDATE="${LEDGERLY_CAMERA_AUTO_UPDATE:-0}"
if ! id ledgerly-camera >/dev/null 2>&1; then useradd --system --home "$DATA_ROOT" --shell /usr/sbin/nologin ledgerly-camera; fi
getent group docker >/dev/null && usermod -aG docker ledgerly-camera || true
mkdir -p "$INSTALL_ROOT" "$DATA_ROOT" /etc/ledgerly-camera
if [[ ! -d "$REPO_INSTALL/.git" ]]; then git clone --no-hardlinks "$REPO_ROOT" "$REPO_INSTALL"; REMOTE="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"; [[ -z "$REMOTE" ]] || git -C "$REPO_INSTALL" remote set-url origin "$REMOTE"; else git -C "$REPO_INSTALL" fetch origin main && git -C "$REPO_INSTALL" pull --ff-only origin main; fi
cd "$SERVER_DIR"; npm install --omit=dev --ignore-scripts
if [[ ! -f /etc/ledgerly-camera/camera.env ]]; then cp install/camera.env.example /etc/ledgerly-camera/camera.env; chmod 600 /etc/ledgerly-camera/camera.env; echo "Created /etc/ledgerly-camera/camera.env — edit it with your Ledgerly URL, NVR pairing token and LAN IP before production use."; fi
mkdir -p "$DATA_ROOT/recordings" "$DATA_ROOT/evidence" "$DATA_ROOT/snapshots" "$DATA_ROOT/exports"; chown -R ledgerly-camera:ledgerly-camera "$DATA_ROOT"; chown -R root:root "$REPO_INSTALL"
sed "s|__SERVER_DIR__|$SERVER_DIR|g" install/ledgerly-camera.service > /etc/systemd/system/ledgerly-camera.service
cp install/ledgerly-camera-health.service /etc/systemd/system/; cp install/ledgerly-camera-health.timer /etc/systemd/system/
sed -e "s|__SERVER_DIR__|$SERVER_DIR|g" -e "s|__REPO_DIR__|$REPO_INSTALL|g" install/ledgerly-camera-update.service > /etc/systemd/system/ledgerly-camera-update.service
cp install/ledgerly-camera-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable ledgerly-camera.service ledgerly-camera-health.timer
if [[ "$AUTO_UPDATE" == "1" ]]; then systemctl enable ledgerly-camera-update.timer; else systemctl disable ledgerly-camera-update.timer >/dev/null 2>&1 || true; fi
systemctl restart ledgerly-camera.service; systemctl restart ledgerly-camera-health.timer; [[ "$AUTO_UPDATE" != "1" ]] || systemctl restart ledgerly-camera-update.timer
cat <<EOF
Ledgerly Camera Server installed.

1. Edit: /etc/ledgerly-camera/camera.env
2. Put the one-time NVR pairing token in CAMERA_SERVER_PAIRING_TOKEN.
3. Restart: systemctl restart ledgerly-camera
4. Verify:  curl http://127.0.0.1:8789/health
5. Logs:    journalctl -u ledgerly-camera -f

Automatic code updates: $([[ "$AUTO_UPDATE" == "1" ]] && echo enabled || echo disabled)
Crash restart + one-minute health recovery: enabled
EOF
