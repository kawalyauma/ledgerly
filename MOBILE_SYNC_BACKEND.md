# Ledgerly Mobile Sync Backend

`mobile-sync` is the backend foundation for the offline-first Ledgerly mobile app. Domain modules register only the collections they intentionally expose; the sync API never accepts arbitrary table names or SQL from a client.

## Core guarantees

- A stable mobile installation ID is registered against the signed-in organization/user and receives an opaque **400-day revocable offline grant**. The grant is stored only as a SHA-256 hash on the server. Successful exchange renews its expiry without changing the secret, so a lost HTTP response cannot strand an offline device; authenticated device registration rotates it.
- The long-lived grant is **not** an API bearer token. On reconnection the app exchanges it at `POST /api/v1/mobile-sync/offline/exchange`; Ledgerly re-checks device status, user status, organization membership and school-account lock state, then returns a normal 15-minute JWT and renews the grant expiry.
- Each client mutation has a permanent `operationId`, strictly increasing per-device `sequence`, client timestamp, collection schema version, stable `recordId`, `baseVersion`, and optional operation/record dependencies.
- `(device, operationId)` and `(device, sequence)` are unique. Reusing an idempotency ID with different content is rejected.
- Terminal conflicts/rejections consume their sequence so one bad year-old edit cannot deadlock every later operation. Retryable dependency/server failures remain `blocked` and do **not** advance the sequence.
- Domain writes supplied by collection adapters are committed in the same D1 `batch()` as sync record-version metadata, tombstone/changelog entries, operation acknowledgement and device sequence advancement.
- Pull progress is tracked independently per collection. A pull delivery does not advance the server cursor until the mobile SQLite transaction has committed and the app acknowledges that exact delivery cursor.
- Bootstrap watermarks are captured **before** snapshots are read. Changes racing with a bootstrap can therefore be redelivered, but cannot be skipped. Snapshot records also seed server-side version metadata for safe later offline edits.
- Deletions are represented by persistent tombstones and `delete` changelog entries.
- Interrupted batches, blocked operations, unacknowledged pull deliveries, schema acknowledgements and next expected sequence are exposed through the recovery endpoint.

## Normal client flow

1. Online login through the normal Ledgerly `/auth/login` endpoint.
2. Register the installation with `POST /api/v1/mobile-sync/devices`. Save `deviceId` and `offlineGrant` in Android Keystore / iOS Keychain.
3. Read `GET /api/v1/mobile-sync/manifest` and run local SQLite schema migrations.
4. Acknowledge every installed collection schema with `POST /api/v1/mobile-sync/schemas/ack`.
5. Bootstrap selected collections with `POST /api/v1/mobile-sync/bootstrap`. Apply the returned snapshot in one durable local transaction, then call `/bootstrap/ack`.
6. While offline, enqueue immutable mutation envelopes locally. Never reuse or renumber an operation once created.
7. When connectivity returns, exchange the offline grant, push queued operations in sequence order, then pull server changes.
8. Apply each pull delivery transactionally in SQLite and call `POST /api/v1/mobile-sync/pull/ack` only after commit.
9. If a request is interrupted, inspect `GET /api/v1/mobile-sync/recovery/:deviceId` and retry using the same batch/operation IDs.

## Collection registration contract

A domain module imports `registerMobileSyncCollection()` from `modules/mobile-sync/backend/registry.ts` and registers a collection definition at module load time. Writable collections must provide `prepareMutation()`; it returns domain `D1PreparedStatement`s without executing them so the sync core can add its metadata and commit the complete operation atomically.

Normal web/server mutations in a synchronized collection must call `prepareServerSyncChange()` and include the returned statements in the same `db.batch()` as the domain write. This is how changes made on web, another phone, kiosk, API or scheduled job enter the mobile change stream.

Each domain module owns its conflict policy and snapshot mapping. The foundation supports `server-wins`, `reject-stale`, `append-only`, `client-wins` and `custom`; server-authoritative/reject-stale is the default choice for mutable school and financial records.

## Security limitation of year-long offline use

A backend cannot remotely revoke a device while that device has no network connection. The mobile agent must therefore encrypt the local database, keep the offline grant in the OS secure keystore, require local PIN/biometric re-authentication, and erase protected data after explicit logout/reset. Once connectivity returns, the server immediately enforces current account/membership/device state before accepting synchronization.
