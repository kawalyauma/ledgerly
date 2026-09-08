# Printerly

Printerly is Ledgerly's remote print-management module. It is designed for institutions that may own only one physical printer but need many authorized users to print to it from anywhere in the world.

```text
Ledgerly web/mobile → Printerly cloud queue → outbound HTTPS → Printerly Node → CUPS → USB/LAN printer
```

The first implementation includes node pairing, machine-token authentication, heartbeat/printer discovery, remote queue submission, priority jobs, secure hold/release, atomic job claiming, lifecycle events, cancellation, a live dashboard, and a Linux/CUPS appliance agent.

## Security model

The school does not open inbound ports. A node pairs with a short-lived six-digit code, receives a high-entropy machine token, and thereafter initiates all communication to Ledgerly over HTTPS. Tokens and pairing codes are stored server-side only as SHA-256 hashes.

## Queue lifecycle

`held → queued → claimed → downloading → spooling → printing → completed`

Jobs may also become `cancelled` before claim or `failed` after a node execution error. Secure-release jobs begin in `held` and require an authorized Ledgerly user to release them.

## Next hardening milestones

- move document submission from external URL to Ledgerly's shared R2/document service
- signed one-use document download URLs
- claim lease recovery for nodes that die after claiming
- real page-count feedback where printer drivers expose it
- quotas, departmental budgets and approval workflows
- node self-update channel and immutable appliance image/installer
- optional local touch-screen release UI/PIN
