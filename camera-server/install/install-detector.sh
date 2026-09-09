#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
SERVER_DIR="${1:-/opt/ledgerly-camera/source/camera-server}"
[[ -f "$SERVER_DIR/detectors/requirements.txt" ]] || { echo "Camera server detector files not found in $SERVER_DIR" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
python3 -m venv "$SERVER_DIR/.venv-detector"
"$SERVER_DIR/.venv-detector/bin/pip" install --upgrade pip
"$SERVER_DIR/.venv-detector/bin/pip" install -r "$SERVER_DIR/detectors/requirements.txt"
sed "s|__SERVER_DIR__|$SERVER_DIR|g" "$SERVER_DIR/install/ledgerly-camera-detector.service" > /etc/systemd/system/ledgerly-camera-detector.service
systemctl daemon-reload
systemctl enable ledgerly-camera-detector.service
cat <<EOF
Optional detector installed.
Set CAMERA_DETECTOR_MODEL in /etc/ledgerly-camera/camera.env to a local model path,
then run: systemctl restart ledgerly-camera-detector
Logs: journalctl -u ledgerly-camera-detector -f
EOF
