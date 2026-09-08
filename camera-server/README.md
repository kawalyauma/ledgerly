# Ledgerly Camera Server

Local-first NVR appliance for Ledgerly Security Cameras. Camera video is recorded on the local computer; Ledgerly cloud services coordinate identity, configuration and remote viewing requests without becoming the primary recording store.

## Requirements

- Node.js 20+
- FFmpeg available as `ffmpeg` (or set `FFMPEG_BIN`)
- A local disk with enough free space for the chosen retention window

## Start

```bash
cd camera-server
CAMERA_SERVER_KEY='replace-with-a-long-random-secret' \
CAMERA_SERVER_HOST=0.0.0.0 \
CAMERA_STORAGE_ROOT=/srv/ledgerly-cameras \
npm start
```

Optional settings:

```text
CAMERA_SERVER_PORT=8789
CAMERA_SEGMENT_SECONDS=300
CAMERA_RETENTION_DAYS=30
CAMERA_MAX_STORAGE_PERCENT=90
CAMERA_CLEANUP_INTERVAL_MS=3600000
FFMPEG_BIN=ffmpeg
```

## Recording model

Each camera is recorded by FFmpeg into independent MP4 segments under:

```text
<storage-root>/<camera-id>/YYYY-MM-DD_HH-MM-SS.mp4
```

Segments are indexed directly from the local filesystem, so a server restart does not lose the recording timeline. A `.protected` sidecar marks important footage that automatic retention must not delete.

## Local API

Public read endpoints:

- `GET /health`
- `GET /v1/storage`
- `GET /v1/recorders`
- `GET /v1/cameras`
- `GET /v1/cameras/:id/summary`
- `GET /v1/cameras/:id/recordings?from=&to=&limit=`
- `GET /v1/cameras/:id/recording/status`

Authenticated control endpoints require `X-Ledgerly-Server-Key`:

- `POST /v1/cameras/:id/recording/start` with `{ "inputUrl": "rtsp://..." }`
- `POST /v1/cameras/:id/recording/stop`
- `POST /v1/cameras/:id/recordings/:segment/protect` with `{ "protected": true }`
- `POST /v1/retention/cleanup`

The recording input currently accepts RTSP/RTSPS, SRT, HTTP or HTTPS sources. Ledgerly Camera mobile transport will provide the local NVR ingest source in the next runtime slice.

## Retention

Cleanup runs periodically and follows two rules:

1. Delete unprotected recordings older than `CAMERA_RETENTION_DAYS`.
2. If the disk is still above `CAMERA_MAX_STORAGE_PERCENT`, remove the oldest unprotected segments until the disk falls below that threshold.

Protected footage is never removed by automatic retention.
