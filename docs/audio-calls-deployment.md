# Ledgerly Audio Calls deployment

Audio Calls is a top-level Ledgerly module. Signaling and call metadata use the authenticated Ledgerly API; microphone media uses WebRTC and is not recorded by default.

## ICE configuration

The backend exposes `/api/v1/audio-calls/ice-config` to authenticated callers. Clients use STUN first and TURN when a direct peer-to-peer path cannot be established.

Configure Worker variables/secrets:

- `AUDIO_CALL_STUN_URLS` — comma-separated STUN URLs. If omitted, Ledgerly uses `stun:stun.cloudflare.com:3478`.
- `AUDIO_CALL_TURN_URLS` — comma-separated TURN/TURNS URLs, for example `turn:turn.example.com:3478,turns:turn.example.com:5349`.
- `AUDIO_CALL_TURN_USERNAME` — TURN username.
- `AUDIO_CALL_TURN_CREDENTIAL` — TURN credential. Store this as a Wrangler secret, never in source control.

Example non-secret configuration in `wrangler.jsonc`:

```json
{
  "vars": {
    "AUDIO_CALL_STUN_URLS": "stun:stun.cloudflare.com:3478",
    "AUDIO_CALL_TURN_URLS": "turn:turn.example.com:3478,turns:turn.example.com:5349"
  }
}
```

Set secrets with Wrangler:

```bash
npx wrangler secret put AUDIO_CALL_TURN_USERNAME
npx wrangler secret put AUDIO_CALL_TURN_CREDENTIAL
```

For production internet calling, configure at least one TURN UDP endpoint and one TLS/TCP fallback (`turns:`) so calls can survive restrictive Wi-Fi, carrier NAT and firewalls.

## Network requirements

Browsers require a secure context for microphone access: production Ledgerly must be served over HTTPS. Android requires `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and internet access; the Ledgerly mobile manifest declares these permissions.

TURN must be reachable from the client networks. Common deployments expose UDP/TCP 3478 and TLS 5349 plus the relay UDP port range configured by the TURN server.

## Privacy

Ledgerly stores call participants, timestamps, status/end reason and short-lived signaling records. Audio media is not written to D1 or R2 by this module. Signaling cleanup is handled by the module scheduler.

## Verification checklist

1. Apply the Audio Calls D1 migration.
2. Sign in as two active workers in the same organization.
3. Confirm both appear in the Calls directory.
4. Place and answer a call on the same LAN.
5. Verify mute, hang-up and call history.
6. Repeat with one device on mobile data and the other on Wi-Fi.
7. Verify the ICE config reports `turnConfigured: true` in production.
8. Test a restrictive network where TURN relay is required.
9. On Android, verify earpiece and speaker routes and that audio mode resets after hang-up.
10. Confirm no audio files are created in D1/R2.
