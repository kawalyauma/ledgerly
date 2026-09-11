# Ledgerly NVR production self-hosting

This document is the production contract for the self-hosted security-camera/NVR appliance.

## Architecture and failure boundary

The media path is deliberately independent of the Ledgerly application stack:

```text
Camera phone / RTSP source
        |
        | WHIP/WebRTC (preferred) or approved LAN media input
        v
MediaMTX on the NVR host
        |
        +--> live WHEP/WebRTC
        +--> HLS fallback where the client/network requires it
        +--> /var/lib/ledgerly-camera/recordings

Ledgerly control plane <----metadata/auth only----> camera-server/src/index.mjs
```

Video bytes do **not** traverse the Ledgerly Node API, PostgreSQL, Redis, Printerly, or finance services. `compose.finance-runtime.yml` intentionally does not start MediaMTX. The NVR is run by `ledgerly-camera.service` plus `camera-server/docker-compose.yml`, so an application/database/printer outage cannot stop an already-publishing camera from recording.

Cloudflare security-camera routes remain the control-plane fallback during self-host migration. Do not claim the whole `/api/v1/security-camera` namespace in the self-hosted Node runtime until every route has PostgreSQL parity. The camera appliance protocol is preserved: deployed cameras continue to publish to their existing `camera.id` stream path and authenticate with their existing device credential.

## Tenant and site isolation

A camera server pairing is bound to exactly one Ledgerly organization. Server configuration only returns non-revoked cameras assigned to that server and organization. The current schema represents the physical appliance/site boundary with the paired NVR server plus its `location`; there is no separate camera `site_id` migration in the repository, so this implementation does not invent one.

Recording directories remain keyed by the opaque organization-scoped camera ID for appliance compatibility. Cross-tenant isolation is enforced by the paired server's organization scope, camera assignment, media credential checks, recording-sync scope, and short-lived playback/evidence access grants.

## Enrollment and credentials

Camera and NVR QR pairing tokens are random, digest-backed, expiring, one-time values. Claims use a conditional `consumed_at IS NULL` update and require exactly one changed row, preventing duplicate concurrent enrollment. Camera device credentials are generated randomly and only their SHA-256 digest is stored by the control plane. Revoked cameras are omitted from NVR configuration and fail device authorization.

The current deployed phone protocol does not support safe in-band credential replacement. Therefore credential rotation is performed by revoking and re-enrolling the device; do not silently change a credential server-side because that would strand existing appliances. A future in-band rotation protocol can be added without changing the MediaMTX path contract.

## Storage, integrity, and retention

Default recording storage is `/var/lib/ledgerly-camera/recordings`. Additional configured volumes are represented as `v0`, `v1`, etc. The local catalog:

- validates camera identifiers and recording names;
- resolves files by canonical `realpath`, rejecting `..` and symlink escapes;
- records integrity sidecars/hash-chain metadata for finalized recordings;
- skips protected footage and legal-hold windows during cleanup;
- will not delete a segment that has changed within `CAMERA_RETENTION_MIN_SEGMENT_AGE_MS` (10 minutes by default);
- enforces per-camera retention plus disk-pressure cleanup;
- persists a catalog snapshot in `CAMERA_CATALOG_STATE`;
- emits a `deleted` tombstone only when a previously observed file disappears from a volume that is currently online;
- never interprets an offline/unmounted disk or an unassigned camera as deleted footage.

This makes catalog reconstruction restart-safe while avoiding destructive false deletions during disk outages.

## Network exposure

Recommended host policy:

| Port | Purpose | Exposure |
| --- | --- | --- |
| 8789 | Ledgerly NVR control/catalog | LAN/VPN only; public edge may proxy only `/v1/access/*` |
| 9997 | MediaMTX admin API | loopback only |
| 8554 | RTSP | LAN/VPN only when required |
| 8888 | HLS | authenticated edge/VPN only |
| 8889 | WHIP/WHEP WebRTC HTTP | authenticated edge/VPN |
| 8189 UDP/TCP | WebRTC ICE media | only as required by the deployment network |

Use `camera-server/Caddyfile.example` for remote HTTPS access. It intentionally does not proxy MediaMTX administration, `/v1/media/auth`, health, storage, assignments, backup, detector ingestion, or raw RTSP. Prefer a VPN/private tunnel over exposing the NVR directly.

`CAMERA_WEBRTC_PUBLIC_BASE_URL` should point at the `/media` prefix of the hardened edge, for example `https://camera.example.com/media`. HLS remains enabled as a fallback for compatible authenticated clients; do not disable MediaMTX auth to make HLS public.

## Services and restart behavior

Install with `camera-server/install/install.sh`. The systemd service runs the Node control/catalog process as the unprivileged `ledgerly-camera` account. Its one privileged action is the root-prefixed `ExecStartPre=+... docker compose up -d mediamtx`; the daemon itself is deliberately removed from the Docker group.

MediaMTX uses `restart: unless-stopped`, a read-only container root, dropped capabilities, `no-new-privileges`, bounded logs, CPU/memory limits, a persistent recording bind mount, and host networking so the external-auth callback can remain loopback-only. The one-minute watchdog checks the control process and the loopback MediaMTX API separately and restarts only the failed component.

Stopping or restarting the Ledgerly Node API does not stop MediaMTX. Stopping the camera control daemon also does not issue `docker compose down`; an already-authorized publisher continues through the media server while the control service recovers. A MediaMTX restart accepts camera reconnect/re-publish through `overridePublisher: yes` and recording resumes on the same camera path.

## Production verification

Run source and policy tests first:

```bash
cd camera-server
npm run check
npm test
```

Then commission the installed appliance:

```bash
sudo systemctl restart ledgerly-camera
curl -fsS http://127.0.0.1:8789/health
curl -fsS http://127.0.0.1:9997/v3/config/global/get
journalctl -u ledgerly-camera --since "10 minutes ago"
```

Validate a real camera end-to-end: pair by QR, confirm the camera appears only in its organization, start WHIP publishing, open WHEP live view, confirm a recording file is created, wait for catalog sync, seek through LIVE + HISTORY, and request an evidence/playback grant.

Perform these failure drills before production cutover:

1. Stop/restart the main Ledgerly API while a camera is publishing. Confirm recording files continue to grow and MediaMTX remains healthy.
2. Stop finance/Printerly/PostgreSQL/Redis services. Confirm the same camera media path continues unaffected.
3. Restart only MediaMTX. Confirm the camera reconnects and a subsequent recording segment appears.
4. Restart `ledgerly-camera.service`. Confirm MediaMTX remains up and the control daemon rebuilds its catalog without duplicate/deleted false positives.
5. Temporarily unmount or make a secondary recording volume unavailable. Confirm reconciliation reports no tombstones for that volume; restore it and confirm history returns.
6. Copy a test recording older than retention, protect another, place another under a legal hold, and keep one file recently modified. Run `/v1/retention/cleanup` with the server key and verify only the eligible file is removed.
7. Verify cross-tenant camera IDs, wrong/revoked device credentials, expired viewer tokens, `../` paths, and symlink escapes are denied.
8. Verify the public edge returns 404 for `/health`, `/v1/media/auth`, `/v1/assignments`, and any attempt to reach MediaMTX `:9997`.

Do not consider NVR cutover complete until these drills pass on the actual target host, disk layout, firewall, and camera network.
