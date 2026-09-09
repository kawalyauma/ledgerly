# Ledgerly Camera Server

Local-first NVR appliance for Ledgerly Security Cameras. Android camera devices publish a single authenticated WebRTC feed to the local computer. MediaMTX records that same feed to local disk and exposes WHEP for authorized live viewers. Ledgerly cloud coordinates identity, permissions, health, archive metadata, events and review state; continuous video and evidence images remain on the NVR.

## Runtime architecture

```text
Ledgerly Camera phone
  ├─ WHIP/WebRTC ────────────> MediaMTX on local NVR
  │                            ├─ continuous fMP4 recording
  │                            └─ WHEP fan-out to live viewers
  └─ MP4 segment fallback ───> camera-server control daemon
                               └─ durable local archive

Local event engine / detector sidecar
  ├─ lightweight FFmpeg scene-change motion detection
  └─ optional person/intrusion/tamper detector webhook
          ↓
    evidence JPEG + protected segment
          ↓
camera-server ── outbound HTTPS ──> Ledgerly control plane
```

Live viewing does not start a second capture on the phone. It reads the NVR's existing feed, so local recording continues while users watch.

## Requirements

- Node.js 20+
- Docker/Compose for the bundled MediaMTX service, or MediaMTX installed separately
- FFmpeg for recording export, evidence snapshots and lightweight local motion detection
- One or more local disks sized for the retention policy

## Start MediaMTX

```bash
cd camera-server
docker compose up -d
```

The bundled configuration uses WHIP/WHEP HTTP signaling, local recording and the camera-server HTTP authorization callback. Publishing requires the paired phone credential. Reading requires a short-lived viewer token from authenticated Ledgerly web. Do not replace the bundled auth configuration with anonymous MediaMTX access.

## Pair and start the control daemon

In Ledgerly web open **Security → Cameras → Pair NVR**, create a one-time token, then run:

```bash
cd camera-server
LEDGERLY_API_URL='https://YOUR-LEDGERLY-URL' \
CAMERA_SERVER_PAIRING_TOKEN='LEDGERLY-CAMERA-SERVER:1:...' \
CAMERA_LOCAL_BASE_URL='http://192.168.1.20:8789' \
CAMERA_WEBRTC_BASE_URL='http://192.168.1.20:8889' \
CAMERA_STORAGE_ROOT='/mnt/cctv-primary' \
CAMERA_STORAGE_VOLUMES='/mnt/cctv-disk2;/mnt/cctv-disk3' \
CAMERA_EVENT_KEY='replace-with-a-long-random-secret' \
npm start
```

The pairing token is consumed once. The resulting long-lived NVR credential is stored in `camera-server-state.json` with restrictive file permissions.

## Remote viewing

LAN viewing uses `CAMERA_WEBRTC_BASE_URL`. For viewing outside the school, expose the NVR only through an authenticated VPN or secure HTTPS tunnel and set:

```bash
CAMERA_WEBRTC_PUBLIC_BASE_URL='https://camera-school.example.com'
CAMERA_CONTROL_PUBLIC_BASE_URL='https://camera-control-school.example.com'
```

Do not publicly expose raw RTSP, the detector webhook, or an anonymous MediaMTX endpoint.

## Recording and outage behavior

Normal path:

```text
phone -> WHIP/WebRTC -> MediaMTX -> local disk
```

If the WebRTC media service cannot be reached, Ledgerly Mobile falls back to short MP4 segments. Segments are moved into a bounded Android internal-storage spool and retried when connectivity returns. The NVR synchronizes only recording metadata to Ledgerly; video bytes remain local.

## Events and evidence

Ledgerly Camera Server v0.7 adds a local event pipeline.

### Motion

The built-in motion path is a conservative FFmpeg scene-change heuristic. It scans the newest local recording only when an enabled Ledgerly motion rule is active. Camera schedules are evaluated on the NVR. If a motion zone is configured, its normalized polygon is reduced to a bounding crop region and the scene detector runs inside that region.

Optional tuning:

```bash
CAMERA_MOTION_SCENE_THRESHOLD=0.18
CAMERA_MOTION_SCAN_MS=30000
CAMERA_EVIDENCE_ROOT='./camera-evidence'
```

This is intended as a lightweight local detector for old/low-power NVR hardware. It is not a substitute for a dedicated object-detection model when accurate person recognition is required.

### Person, intrusion, line crossing and tamper detectors

A local detector sidecar can submit events without uploading video to Ledgerly:

```bash
curl -X POST http://127.0.0.1:8789/v1/events \
  -H 'Content-Type: application/json' \
  -H 'X-Ledgerly-Event-Key: replace-with-a-long-random-secret' \
  -d '{
    "cameraId":"cam_example",
    "eventType":"person",
    "confidence":0.94,
    "zoneId":"camzone_example",
    "message":"Person detected at the main gate",
    "metadata":{"detector":"local-yolo"}
  }'
```

Supported event types are `motion`, `person`, `line_crossing`, `intrusion`, `tamper` and `manual`. Calls from loopback are accepted for local sidecars; remote detector calls require `X-Ledgerly-Event-Key`.

For each accepted event the NVR can:

- associate the nearest local recording segment;
- extract a JPEG evidence frame with FFmpeg;
- protect the recording immediately when the active Ledgerly rule requires protection;
- synchronize event metadata and the local evidence path to Ledgerly;
- create alert metadata according to the Ledgerly event rule;
- keep the JPEG and video bytes local.

When a user turns an event into an incident, Ledgerly sends the open incident protection window back to the NVR. Every local segment overlapping that window is marked protected and is excluded from normal retention cleanup.

## Zones, schedules and rules

Configure these in **Security → Events → Zones, schedules & rules**.

- **Zones** are stored as normalized camera-frame polygons. The built-in motion detector uses their bounding crop; external detector sidecars can submit the exact zone id they matched.
- **Schedules** support days of week, start/end time and timezone, including overnight windows such as `18:00–06:00`.
- **Rules** combine camera, event type, optional zone, optional schedule, minimum confidence, severity, alert creation and clip protection.

## Retention and storage

Useful settings:

```text
CAMERA_RETENTION_DAYS=30
CAMERA_MAX_STORAGE_PERCENT=90
CAMERA_CLEANUP_INTERVAL_MS=3600000
CAMERA_SEGMENT_SECONDS=300
CAMERA_SERVER_PORT=8789
CAMERA_SERVER_HOST=0.0.0.0
FFMPEG_BIN=ffmpeg
```

Cleanup removes unprotected recordings older than the effective camera retention window and then removes the oldest unprotected files if a volume remains above the configured threshold. Protected event and incident footage is exempt.

## Android appliance behavior

A paired Security Camera device starts a sticky foreground keepalive service, holds a partial wake lock, reports battery/temperature/thermal state, reconnects the NVR stream after failure, and relaunches the dedicated camera activity after boot. Capture pauses automatically at severe thermal levels and resumes after the device cools.

For permanent installations keep the phone ventilated, screen brightness low, away from direct sun, and use conservative 720p/15fps settings on older hardware.

## Control API

Common read endpoints:

- `GET /health`
- `GET /v1/storage`
- `GET /v1/assignments`
- `GET /v1/cameras`
- `GET /v1/cameras/:id/summary`
- `GET /v1/cameras/:id/recordings`

Camera/fallback ingest:

- `POST /v1/ingest/:cameraId/segments`

Local detector ingest:

- `POST /v1/events`

Local MediaMTX callback:

- `POST /v1/media/auth`

Short-lived local media grants:

- `GET /v1/access/:token/playback`
- `GET /v1/access/:token/export`
- `GET /v1/access/:token/evidence`

Administrative control endpoints requiring `X-Ledgerly-Server-Key` remain available for retention, clip protection and legacy recorder control.
