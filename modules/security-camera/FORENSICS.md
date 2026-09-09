# Security Camera Forensics v0.17

Ledgerly keeps CCTV bytes on the NVR while storing integrity and custody metadata in D1.

## Optional evidence-manifest signing

Forensic export manifests are always SHA-256 fingerprinted. To also HMAC-sign each manifest, configure a Worker secret named `SECURITY_EVIDENCE_SIGNING_KEY` with a long random value. Keep this secret out of the repository and rotate it only under a documented evidence-governance procedure.

Without the secret, manifests remain usable and are marked `unsigned`; source segment fingerprints and export hashes are still recorded.

## Legal holds

A legal hold contains a camera, UTC time window, reason, optional incident and creator. Active holds are sent outbound to the assigned NVR and cached locally in `camera-forensics-state.json` (or `CAMERA_FORENSICS_STATE`). Primary retention and backup-retention cleanup both skip overlapping footage. The cached hold remains effective during cloud outages. Releasing a hold takes effect only after the NVR receives the refreshed hold set.

Do not delete the forensic-state file manually on a commissioned appliance.

## Forensic exports

A forensic export snapshots the exact source segment list and each segment's accepted SHA-256/chain state before export creation. By default, Ledgerly blocks windows containing `tampered` or `chain_broken` footage. The generated manifest records the export ID, camera, time window, source recording IDs, hashes, integrity states and optional incident.

When the local NVR completes the MP4 export it calculates the finished file SHA-256 and reports it to Ledgerly. An investigator can later calculate SHA-256 on any copied file and submit it through Security > Forensics (web or mobile). Ledgerly records `copy_verified` or `copy_mismatch` in chain of custody.

## Custody records

Forensic custody entries are append-only application records for legal-hold creation/release, export requests, NVR export hashing, manifest views and copied-file verification. Existing Security audit events remain available separately for broader user/API activity.

## Operational boundary

The HMAC signature proves a manifest was produced by a Ledgerly deployment possessing the configured signing key; it is not a qualified digital signature or a substitute for jurisdiction-specific evidentiary procedures. Preserve access-control, operator identity, clock synchronization, physical NVR security and documented evidence-handling procedures alongside the technical controls.
