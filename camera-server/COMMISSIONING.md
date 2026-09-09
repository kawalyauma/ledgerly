# Ledgerly Camera NVR Commissioning

Use this after installing or upgrading a school NVR and before declaring the camera system production-ready.

## 1. Load the production environment

The commissioning command reads the same environment variables used by `ledgerly-camera.service`. At minimum configure:

- `LEDGERLY_API_URL`
- `CAMERA_STORAGE_ROOT`
- `CAMERA_LOCAL_BASE_URL`
- `CAMERA_WEBRTC_BASE_URL`
- `CAMERA_SERVER_KEY`
- `CAMERA_EVENT_KEY`
- `CAMERA_DETECTOR_MEDIA_KEY`

Do not leave the example `replace-me` values in production.

## 2. Offline/package preflight

Run before starting the services:

```bash
cd /opt/ledgerly-camera/current/camera-server
set -a
. /etc/ledgerly-camera/camera.env
set +a
npm run commission -- --offline
```

This validates the packaged runtime, required configuration and writable recording/backup storage without requiring MediaMTX or the camera daemon to be running.

## 3. Full commissioning

After the systemd services are active:

```bash
cd /opt/ledgerly-camera/current/camera-server
set -a
. /etc/ledgerly-camera/camera.env
set +a
npm run commission
```

The command verifies:

- package/deployment artifacts
- required secrets and endpoints
- writable primary recording storage
- optional local/NAS backup writeability
- local camera control `/health`
- MediaMTX WebRTC listener
- MediaMTX RTSP listener

The result is JSON and the process exits non-zero when a required deployment gate fails. This makes the same command suitable for technician checklists, shell automation and future deployment pipelines.

## 4. Ledgerly certification

In Ledgerly open **Security → Resilience** or, on Ledgerly Mobile, **Security Cameras → Readiness**.

1. Review the live readiness score.
2. Fix every required failed gate.
3. Run a non-disruptive recovery drill if secondary NVRs are configured.
4. Choose **Certify current state**.

Ledgerly stores the certification and recovery-drill records with operator, timestamp, score and findings. The live readiness score continues to change after certification, so historical certification never hides a later failure.

## Acceptance guidance

A normal production go-live should have:

- readiness state `ready`
- no required failed gates
- fresh recordings for every recording-enabled camera
- at least one healthy NVR
- no unresolved critical Security alerts
- safe storage headroom
- a passing recovery drill for cameras that require NVR redundancy
- a healthy local/NAS backup for sites where archive redundancy is required

The NVR and Ledgerly cloud keep video local-first: commissioning records contain health and configuration metadata, not CCTV footage.
