# Ledgerly Camera Server

Local-first NVR appliance for Ledgerly Security Cameras. Android camera phones record short MP4 segments and send them directly over the LAN to this computer. Video bytes stay on the local disk; Ledgerly cloud stores identity, configuration, health, recording metadata and live-session control state.

## Requirements

- Node.js 20+
- FFmpeg (kept for RTSP/SRT/HTTP camera compatibility)
- A local disk for recordings
- The computer and camera phones on the same LAN/Wi-Fi

## Pair the NVR

1. In Ledgerly open **Security → Cameras → Pair NVR**.
2. Give the server a name/location and generate a one-time pairing token.
3. Start the server with that token once:

```bash
cd camera-server
LEDGERLY_API_URL='https://your-ledgerly-host' \
CAMERA_SERVER_PAIRING_TOKEN='LEDGERLY-CAMERA-SERVER:1:...' \
CAMERA_LOCAL_BASE_URL='http://192.168.1.20:8789' \
CAMERA_SERVER_HOST=0.0.0.0 \
CAMERA_STORAGE_ROOT=/srv/ledgerly-cameras \
npm start
```

The resulting server credential is stored in `camera-server-state.json` with mode `0600`. On subsequent starts the pairing token is not required.

## Continuous phone recording

After an Android camera is assigned to this NVR, Ledgerly Mobile receives an ingest URL such as:

```text
http://192.168.1.20:8789/v1/ingest/cam_xxx/segments
```

The phone records approximately 20-second MP4 segments. Each segment is authenticated using the camera's existing Ledgerly device credential and sent directly to the NVR. If the NVR/Wi-Fi is temporarily unavailable, the phone keeps a persistent pending-segment queue and retries later.

Files are stored under:

```text
<storage-root>/<camera-id>/YYYY-MM-DD_HH-MM-SS.mp4
```

The server periodically synchronizes only segment metadata (camera, timestamps, local path, size and protection state) back to Ledgerly.

## Cloud coordination

The NVR performs outbound HTTPS only:

- pairs once using a one-time server token;
- heartbeat every ~15 seconds;
- downloads its assigned cameras and credential hashes;
- uploads recording metadata in batches;
- receives short-lived live-view signaling requests.

No inbound Internet port is required for cloud control. The local ingest endpoint is intended for the trusted LAN.

## Retention

```text
CAMERA_RETENTION_DAYS=30
CAMERA_MAX_STORAGE_PERCENT=90
CAMERA_CLEANUP_INTERVAL_MS=3600000
```

Oldest unprotected footage is removed first. `.protected` sidecars prevent automatic deletion.

## Local API

- `GET /health`
- `GET /v1/storage`
- `GET /v1/assignments`
- `GET /v1/cameras`
- `GET /v1/cameras/:id/recordings`
- `GET /v1/cameras/:id/summary`
- `POST /v1/ingest/:cameraId/segments` — Android segmented MP4 ingest
- `POST /v1/cameras/:id/recordings/:segment/protect`
- `POST /v1/retention/cleanup`

`CAMERA_SERVER_KEY` remains available for administrative local mutation endpoints.
