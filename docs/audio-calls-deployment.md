# Ledgerly Audio Calls deployment

Audio Calls is a top-level Ledgerly collaboration module. Signaling, permissions, presence and call history use the authenticated Ledgerly API; microphone media uses WebRTC. Audio is not recorded by this module.

## Apply database migrations

Apply both Audio Calls migrations before deploying the feature:

```bash
npx wrangler d1 migrations apply FINANCE_DB --remote
```

The second migration adds one active-call lock per organization/user so two simultaneous requests cannot place the same worker in two calls.

## ICE, STUN and TURN

The authenticated endpoint `/api/v1/audio-calls/ice-config` returns the ICE servers a signed-in caller may use. Ledgerly uses STUN for direct connectivity and TURN when peer-to-peer connectivity cannot be established.

Supported Worker settings:

- `AUDIO_CALL_STUN_URLS` — comma-separated STUN URLs. Default: `stun:stun.cloudflare.com:3478`.
- `AUDIO_CALL_TURN_URLS` — comma-separated TURN/TURNS URLs, for example `turn:turn.example.com:3478,turns:turn.example.com:5349`.
- `AUDIO_CALL_TURN_SECRET` — recommended coturn TURN REST shared secret. Store only as a Worker secret.
- `AUDIO_CALL_TURN_TTL_SECONDS` — optional short-lived TURN credential lifetime. Default 3600 seconds; Ledgerly clamps it to 300–86400 seconds.
- `AUDIO_CALL_RING_TIMEOUT_SECONDS` — optional ring timeout. Default 35 seconds; allowed range 10–120 seconds.
- `AUDIO_CALL_TURN_USERNAME` and `AUDIO_CALL_TURN_CREDENTIAL` — supported static-credential fallback for existing TURN installations. Ephemeral TURN REST credentials are preferred.

Example non-secret configuration:

```json
{
  "vars": {
    "AUDIO_CALL_STUN_URLS": "stun:stun.cloudflare.com:3478",
    "AUDIO_CALL_TURN_URLS": "turn:turn.example.com:3478,turns:turn.example.com:5349",
    "AUDIO_CALL_TURN_TTL_SECONDS": "3600",
    "AUDIO_CALL_RING_TIMEOUT_SECONDS": "35"
  }
}
```

Set the production TURN REST secret:

```bash
npx wrangler secret put AUDIO_CALL_TURN_SECRET
```

For coturn, enable the TURN REST shared-secret mechanism (`use-auth-secret`) and configure the same value as its `static-auth-secret`. Ledgerly then generates a short-lived username in the form `<expiry>:<ledgerly-user-id>` plus an HMAC-SHA1 credential. The shared secret itself is never returned to the browser or Android app.

For broad internet reliability expose a TURN UDP/TCP endpoint and a TLS fallback (`turns:`). Common deployments use 3478 for TURN and 5349 for TURN-TLS plus a restricted relay UDP port range. Secure that range at the firewall and monitor TURN bandwidth because relayed calls carry media through the TURN server.

## Permissions and availability

Audio Calls uses `audio-calls:read` and `audio-calls:write`. Ledgerly owners/admins retain their normal scope bypass; other users must be assigned the appropriate scopes before they can use calling.

The server enforces organization isolation, participant membership, one-active-call locks, Do Not Disturb/busy state, ringing timeout, signaling recipient checks, payload limits and signaling rate limits.

The web Calls screen exposes Available and Do Not Disturb. Do Not Disturb is persisted locally and sent on presence heartbeats; the server rejects new calls to a worker whose fresh presence is DND.

## Web requirements

Production web Ledgerly must be served over HTTPS because microphone capture requires a secure browser context. Incoming calls are surfaced by the global Ledgerly call action while the authenticated page is running. Web ringtone/vibration is best-effort because browsers may block audio before user interaction or throttle/suspend background tabs.

## Android requirements

The Android app declares internet, microphone, audio-routing, vibration and foreground microphone service permissions. During an active call it switches Android to communication audio mode, supports earpiece/speaker routing and runs an ongoing foreground notification so WebRTC media is not tied to the visible Calls screen. Previous audio mode, speaker state and microphone mute state are restored when the call ends.

Incoming calls ring and vibrate while the normal Ledgerly app process is active. A completely killed application cannot be awakened by the current polling transport. True killed-app incoming call delivery requires an OS push transport such as FCM/CallStyle and server-side push-token registration; do not market the current build as supporting killed-app ringing.

## Call lifecycle and privacy

Ledgerly stores participants, timestamps, status/end reason, availability and short-lived WebRTC signaling. Signaling is automatically cleaned up. Unanswered calls become `missed`; ended/declined/cancelled/failed calls release participant locks. A conservative orphan cleanup handles exceptionally stale accepted calls after crashes.

No microphone audio is written to D1 or R2. Recording would be a separate future feature requiring explicit product, permission and privacy design.

## Production verification checklist

1. Apply both Audio Calls D1 migrations.
2. Assign `audio-calls:read` and `audio-calls:write` to intended non-admin workers.
3. Configure STUN and production TURN/TURNS endpoints.
4. Configure `AUDIO_CALL_TURN_SECRET` on Ledgerly and the matching shared secret in coturn.
5. Sign in as two workers in the same organization and verify presence/directory isolation.
6. Place, answer, decline, cancel and end calls; verify history/statuses.
7. Verify mute, Android speaker/earpiece switching and restoration after hang-up.
8. Verify incoming web alert and Android ringtone/vibration while each app is active.
9. Put one device on mobile data and one on Wi-Fi; confirm a call establishes.
10. Force a TURN-only/restrictive-network case and confirm relay connectivity.
11. Enable Do Not Disturb and confirm the caller is rejected by the backend.
12. Attempt simultaneous calls to the same user and confirm only one succeeds.
13. Interrupt a connected web network briefly and confirm ICE restart/reconnect behavior.
14. Verify missed calls expire according to the configured ring timeout.
15. Confirm no audio objects/files are created in D1 or R2.
