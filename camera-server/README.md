# Ledgerly Camera Server

Local-first NVR appliance for Ledgerly Security Cameras. Android camera devices publish a single authenticated WebRTC feed to the local computer. MediaMTX records that same feed to local disk and exposes WHEP for authorized live viewers. Ledgerly cloud coordinates identity, permissions, health and archive metadata; the continuous video archive remains on the NVR.

## Runtime architecture

```text
Ledgerly Camera phone
  ├─ WHIP/WebRTC ────────────> MediaMTX on local NVR
  │                            ├─ continuous fMP4 recording
  │                            └─ WHEP fan-out to live viewers
  └─ MP4 segment fallback ───> camera-server control daemon
                               └─ durable local archive

camera-server ── outbound HTTPS ──> Ledgerly control plane
```

Live viewing does not start a second capture on the phone. It reads the NVR's existing feed, so local recording continues while users watch.

## Requirements

- Node.js 20+
- Docker/Compose for the bundled MediaMTX service, or MediaMTX 1.21+ installed separately
- FFmpeg for legacy/external network-camera recorder inputs
- A local disk sized for your retention policy

## 1. Start MediaMTX

```bash
cd camera-server
docker compose up -d
```

The bundled configuration uses:

- WHIP/WHEP HTTP signaling on port `8889`
- WebRTC ICE UDP/TCP on port `8189`
- HTTP authorization callback to the local camera-server daemon
- 5-minute fMP4 recording segments under `camera-storage/<camera-id>/`

Publishing requires the paired phone's device credential. Reading requires a short-lived viewer token issued by authenticated Ledgerly web. Do not replace the bundled HTTP auth configuration with anonymous MediaMTX access.

## 2. Pair and start the control daemon

In Ledgerly web open **Security → Cameras → Pair NVR**, create a one-time token, then run:

```bash
cd camera-server
LEDGERLY_API_URL='https://YOUR-LEDGERLY-URL' \
CAMERA_SERVER_PAIRING_TOKEN='LEDGERLY-CAMERA-SERVER:1:...' \
CAMERA_LOCAL_BASE_URL='http://192.168.1.20:8789' \
CAMERA_WEBRTC_BASE_URL='http://192.168.1.20:8889' \
CAMERA_STORAGE_ROOT='./camera-storage' \
npm start
```

The pairing token is consumed once. The resulting long-lived NVR credential is stored in `camera-server-state.json` with restrictive file permissions.

## Remote live viewing

LAN viewing can use `CAMERA_WEBRTC_BASE_URL` directly. For viewing from outside the school, expose the NVR through an authenticated VPN or secure HTTPS tunnel and set:

```bash
CAMERA_WEBRTC_PUBLIC_BASE_URL='https://camera-school.example.com'
```

Do not publicly expose raw RTSP or an anonymous MediaMTX endpoint. The public endpoint must forward the MediaMTX WHEP/WHIP HTTP service and provide a network path for WebRTC ICE traffic (direct UDP/TCP or TURN where required).

## Recording and outage behavior

Normal path:

```text
phone -> WHIP/WebRTC -> MediaMTX -> local disk
```

If the WebRTC media service cannot be reached, Ledgerly Mobile falls back to short MP4 recording segments. Segments are moved into a bounded Android internal-storage spool and retried against the NVR control daemon when connectivity returns. This prevents an NVR/media restart from creating an immediate recording gap.

The NVR scans completed MediaMTX files and synchronizes only recording metadata to Ledgerly. Video bytes remain local.

## Retention

Optional settings:

```text
CAMERA_RETENTION_DAYS=30
CAMERA_MAX_STORAGE_PERCENT=90
CAMERA_CLEANUP_INTERVAL_MS=3600000
CAMERA_SEGMENT_SECONDS=300
CAMERA_SERVER_PORT=8789
CAMERA_SERVER_HOST=0.0.0.0
FFMPEG_BIN=ffmpeg
```

Cleanup removes unprotected recordings older than the retention window and then removes the oldest unprotected files if disk usage remains above the configured threshold. Protected clips are exempt.

## Android appliance behavior

A paired Security Camera device starts a sticky foreground keepalive service, holds a partial wake lock, reports battery/temperature/thermal state, reconnects the NVR stream after failure, and relaunches the dedicated camera activity after boot. Capture pauses automatically at severe thermal levels and resumes after the device cools.

For permanent installations keep the phone ventilated, screen brightness low, away from direct sun, and use conservative 720p/15fps settings on older hardware.

## Control API

Public/local read endpoints:

- `GET /health`
- `GET /v1/storage`
- `GET /v1/assignments`
- `GET /v1/cameras`
- `GET /v1/cameras/:id/summary`
- `GET /v1/cameras/:id/recordings`

Camera ingest:

- `POST /v1/ingest/:cameraId/segments` — authenticated fallback MP4 upload

Local MediaMTX callback:

- `POST /v1/media/auth` — loopback-only WHIP/WHEP authorization

Administrative control endpoints requiring `X-Ledgerly-Server-Key` remain available for retention, clip protection and legacy FFmpeg recorder control.
