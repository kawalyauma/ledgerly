# Ledgerly Camera Server

The Camera Server is the on-premise NVR side of Ledgerly Security Cameras. Android phones stream on the local network to this machine; this machine records to local disks and only opens a remote live path when an authorized Ledgerly user requests one.

## Current foundation

- Local storage root and health API.
- Storage capacity/free-space reporting.
- Separate package so the NVR can run as an always-on appliance without loading the Ledgerly web application.
- No inbound internet exposure is required by the intended architecture.

## Runtime target

The next slices will add camera-server QR pairing, authenticated outbound control-channel heartbeats, FFmpeg/GStreamer ingest, 2–5 minute recording segmentation, recording index synchronization, retention/protected clips, offline-gap reconciliation, and WebRTC signaling/relay for on-demand live viewing.

## Run

```bash
cd camera-server
CAMERA_STORAGE_ROOT=/srv/ledgerly-camera npm start
```

Health check:

```bash
curl http://127.0.0.1:8789/health
```

Environment variables:

- `CAMERA_SERVER_HOST` defaults to `127.0.0.1`.
- `CAMERA_SERVER_PORT` defaults to `8789`.
- `CAMERA_STORAGE_ROOT` defaults to `./camera-storage`.

The server intentionally binds to loopback by default until authenticated LAN ingest and server pairing are implemented.
