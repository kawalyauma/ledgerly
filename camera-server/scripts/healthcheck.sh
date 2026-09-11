#!/usr/bin/env bash
set -euo pipefail

CONTROL_URL="${CAMERA_HEALTH_CONTROL_URL:-http://127.0.0.1:8789/health}"
MEDIA_URL="${CAMERA_HEALTH_MEDIA_URL:-http://127.0.0.1:9997/v3/config/global/get}"

control_ok() {
  /usr/bin/curl --fail --silent --show-error --max-time 5 "$CONTROL_URL" >/dev/null
}

media_ok() {
  /usr/bin/curl --fail --silent --show-error --max-time 5 "$MEDIA_URL" >/dev/null
}

if ! control_ok; then
  echo "Ledgerly camera control health check failed; restarting only the control daemon." >&2
  /usr/bin/systemctl restart ledgerly-camera.service
  sleep 2
  control_ok || { echo "Ledgerly camera control did not recover." >&2; exit 1; }
fi

if ! media_ok; then
  echo "MediaMTX health check failed; restarting only the media service." >&2
  /usr/bin/docker compose restart mediamtx >/dev/null 2>&1 || /usr/bin/docker compose up -d mediamtx
  sleep 3
  media_ok || { echo "MediaMTX did not recover." >&2; exit 1; }
fi

exit 0
