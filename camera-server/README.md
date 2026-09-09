# Ledgerly Camera Server

Local-first NVR appliance for Ledgerly Security Cameras. Android camera devices publish one authenticated WebRTC/WHIP feed to the local computer. MediaMTX records that same feed to local disks and exposes WHEP for authorized viewers. Ledgerly coordinates identity, permissions, health, events, archive metadata, fleet configuration and short-lived access grants; continuous video and evidence bytes remain on the NVR.

## Architecture

```text
Ledgerly Camera phone
  ├─ WHIP/WebRTC ─────────────> MediaMTX
  │                              ├─ continuous local recording
  │                              ├─ WHEP live fan-out
  │                              └─ optional local detector read
  └─ MP4 fallback segments ───> camera-server daemon
                                 └─ durable local archive

camera-server ── outbound HTTPS ──> Ledgerly control plane
```

Watching one camera or a multi-camera monitor wall never starts another phone capture. Viewers fan out from the NVR's existing stream while recording continues.

## Production install

Requirements: Linux with systemd, Node.js 20+, Docker + Compose, Git, curl and FFmpeg.

From a Ledgerly Git checkout:

```bash
sudo camera-server/install/install.sh
sudo nano /etc/ledgerly-camera/camera.env
sudo systemctl restart ledgerly-camera
curl http://127.0.0.1:8789/health
```

The installer creates a dedicated `ledgerly-camera` service user, clones an updateable local source checkout, installs the NVR as a systemd service, enables crash restart and a one-minute `/health` watchdog, and keeps recordings/evidence outside the source tree under `/var/lib/ledgerly-camera` by default.

Set the one-time token created in **Security → Cameras → Pair NVR** as `CAMERA_SERVER_PAIRING_TOKEN` for the first successful pairing. After it is consumed, the long-lived NVR credential is stored in the protected server state file.

### Optional safe auto-update

Auto-update is deliberately opt-in:

```bash
sudo LEDGERLY_CAMERA_AUTO_UPDATE=1 camera-server/install/install.sh
```

The daily updater refuses dirty checkouts and non-fast-forward histories. It only advances to `origin/main` when the installed checkout is a clean fast-forward, then refreshes dependencies/MediaMTX and restarts the service. Health recovery does not depend on auto-update being enabled.

Useful commands:

```bash
systemctl status ledgerly-camera
journalctl -u ledgerly-camera -f
systemctl status ledgerly-camera-health.timer
systemctl status ledgerly-camera-update.timer
```

## Storage

Example production configuration:

```text
CAMERA_STORAGE_ROOT=/mnt/cctv-primary
CAMERA_STORAGE_VOLUMES=/mnt/cctv-disk2;/mnt/cctv-disk3
CAMERA_RETENTION_DAYS=30
CAMERA_MAX_STORAGE_PERCENT=90
```

`docker-compose.yml` mounts `CAMERA_STORAGE_ROOT` into MediaMTX, so continuous recordings go to the configured CCTV disk rather than the application checkout. Additional volumes are used by the Ledgerly storage pool for fallback/archive data. Protected event and incident footage is excluded from normal retention cleanup.

## Remote viewing

LAN viewing uses `CAMERA_WEBRTC_BASE_URL`. For off-site viewing, expose the NVR only through an authenticated VPN or secure tunnel and configure:

```text
CAMERA_WEBRTC_PUBLIC_BASE_URL=https://camera-school.example.com
CAMERA_CONTROL_PUBLIC_BASE_URL=https://camera-control-school.example.com
```

Do not publicly expose raw RTSP, the detector webhook or anonymous MediaMTX access.

## Monitor wall, groups and snapshots

Ledgerly Security Cameras v0.8 adds:

- **Security → Monitor wall** — saved layouts with up to nine simultaneous WHEP viewers;
- **Security → Fleet** — camera groups, lifecycle state, diagnostics and operator snapshots;
- short-lived NVR snapshot grants generated from the newest indexed local segment;
- lifecycle states `active`, `maintenance`, `disabled` and `decommissioned`; non-active states automatically pause recording while preserving historical footage and device identity.

## Visual zones

Open **Security → Events → Zones, schedules & rules**. Ledgerly requests a short-lived snapshot from the NVR and displays it as an SVG drawing canvas. Click around the image to define a normalized polygon. Existing zones can be edited, reset or expanded to full frame. Normalized points remain valid across capture-resolution changes.

The built-in low-resource motion detector uses the configured zone as an FFmpeg crop. External local detectors can report the exact zone id they matched.

## Optional person/object detector

The default NVR does not require Python or an AI model. To add local person/object detection, place a compatible local Ultralytics model on the NVR, set these values in `/etc/ledgerly-camera/camera.env`:

```text
CAMERA_EVENT_KEY=<long-random-event-secret>
CAMERA_DETECTOR_MEDIA_KEY=<different-long-random-read-secret>
CAMERA_DETECTOR_MODEL=/var/lib/ledgerly-camera/models/detector.onnx
```

Then install the optional sidecar:

```bash
sudo camera-server/install/install-detector.sh /opt/ledgerly-camera/source/camera-server
sudo systemctl restart ledgerly-camera-detector
journalctl -u ledgerly-camera-detector -f
```

The detector reads local RTSP using the dedicated detector-media credential and submits metadata-only `person` or `object` events to the localhost event endpoint using the separate event credential. Frames remain on the NVR. Event confidence, object class and bounding box metadata can be indexed in Ledgerly; evidence snapshots and video remain local.

## Event/evidence pipeline

Built-in event types include `motion`, `person`, `object`, `line_crossing`, `intrusion`, `tamper` and `manual`. Matching rules can create alerts and protect clips. Turning an event into an incident creates an NVR protection window, and every overlapping recording segment is marked protected.

## Android appliance behavior

A paired Android Security Camera uses a sticky foreground appliance service, partial wake lock, boot recovery, thermal safeguards, WebRTC reconnect and durable fallback segments. Conservative 720p/15fps profiles are recommended for older phones, with ventilation and safe charging.

## Local API highlights

Read/status:

- `GET /health`
- `GET /v1/storage`
- `GET /v1/assignments`
- `GET /v1/cameras`
- `GET /v1/cameras/:id/recordings`

Ingest/auth:

- `POST /v1/ingest/:cameraId/segments`
- `POST /v1/events`
- `POST /v1/media/auth` — localhost MediaMTX authorization callback

Short-lived grants:

- `GET /v1/access/:token/playback`
- `GET /v1/access/:token/export`
- `GET /v1/access/:token/evidence`
- `GET /v1/access/:token/snapshot`

Administrative endpoints protected by `X-Ledgerly-Server-Key` remain available for local maintenance operations.
