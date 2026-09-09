# Ledgerly Camera Backup & Disaster Recovery

Security Cameras v0.11 separates two failure domains:

- **NVR failover** keeps a camera recording when its primary recorder fails.
- **Archive replication** keeps a second copy of recordings that have already closed on disk.

Neither feature stores CCTV video in Ledgerly cloud.

## Local / NAS backup

Mount a second disk or NAS on the NVR host, then set:

```text
CAMERA_BACKUP_ROOT=/mnt/cctv-backup
CAMERA_BACKUP_STATE=/var/lib/ledgerly-camera/backup-state.json
CAMERA_BACKUP_INTERVAL_MS=60000
CAMERA_BACKUP_MAX_PER_RUN=20
CAMERA_BACKUP_RETENTION_DAYS=90
```

The NVR scans completed MP4 segments, copies protected/incident footage first, writes through a temporary `.partial-*` file, verifies the resulting byte size, then atomically renames it into the backup archive. `.protected` markers are replicated as well. Protected backup clips are excluded from backup retention cleanup.

A backup target should be a dedicated local disk, mounted NAS, or other filesystem managed by the school. Do not configure an R2/S3/cloud object-storage mount as the default CCTV backup path unless the school has explicitly chosen cloud video storage and completed the required privacy/security review.

## Health and alerts

Every backup cycle reports only metadata to Ledgerly:

- enabled / disabled
- healthy / lagging / warning / failed
- pending file count and bytes
- replication lag
- cumulative replicated files and bytes
- last successful copy
- last error

Lag beyond one hour is reported as `lagging`. An inaccessible/unwritable target is `failed`. These conditions become normal Security Camera alerts and therefore use the same escalation policies as camera/NVR failures.

## Recommended deployment

For important sites:

```text
Camera phone
  -> Primary NVR local recording
  -> Secondary NVR automatic failover

Primary NVR closed recordings
  -> NAS / independent backup disk
```

Keep the NAS/backup filesystem on different physical storage from the NVR's primary recording disk. A second directory on the same physical disk protects against accidental deletion but not disk failure.

## Recovery test

1. Verify **Security → Resilience** shows the primary and secondary NVR healthy.
2. Trigger a manual switch to the secondary NVR and confirm the phone reconnects.
3. Restore primary and verify failback.
4. Confirm backup status is `healthy` with a recent successful copy.
5. Stop/unmount the backup target and confirm Ledgerly reports backup failure/lag.
6. Restore it and confirm the backlog drains.
7. Open a protected incident clip and verify its `.protected` copy exists on the backup target.
