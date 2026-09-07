# Ledgerly Attendance 1.2

Attendance is a standalone Ledgerly module backed by Cloudflare Workers and D1. It requires School Management for students, staff, classes, terms and permissions, while Attendance owns the canonical attendance records.

## Enablement

Apply `0023_standalone_attendance.sql` and `0024_attendance_face_engine.sql`, then enable `school-management` followed by `attendance` in Modules. The module dependency guard prevents enabling Attendance first and prevents disabling School Management while Attendance is active.

Existing `school_*_attendance_*` history is preserved/backfilled by the standalone migration. New integrations use the canonical `att_*` tables.

## Canonical flow

```text
capture method -> att_events -> verification -> att_policies -> att_records
```

`att_events` is capture/audit history. `att_records` is the interpreted official record. Corrections append to `att_corrections` before an official row changes.

## Android device boundary

Android kiosks use `/api/v1/attendance/device` with dedicated device credentials rather than administrator JWTs.

Core device routes include health/bootstrap, offline sync, face state, encrypted template sync, and face enrollment-job claim/complete/fail.

The v1 kiosk supports only the Android phone/tablet built-in camera. USB/UVC, IP camera, RTSP and ONVIF are intentionally out of scope.

## On-device FACE engine

```text
built-in device camera
 -> bundled ML Kit face detector
 -> face quality checks
 -> randomized active challenge
    - close both eyes and hold, or
    - turn head and hold
 -> FaceNet 128-dimensional embedding
 -> local encrypted 1:N matching
 -> minimum identity threshold
 -> second-best ambiguity margin
 -> official attendance event
```

A close/ambiguous match is rejected rather than assigned to the nearest person.

## Biometric enrollment

The web control centre creates an enrollment job for a specific student/staff member and kiosk. Production enrollment requires the person to be physically present at that kiosk and pass the live challenge. The kiosk creates the embedding locally.

The Worker stores the embedding encrypted with AES-GCM using the `BIOMETRIC_ENCRYPTION_KEY` secret. Encryption is cryptographically bound to organization + person + algorithm. Authorized kiosks sync templates over their authenticated device API and keep the local copy encrypted with Android Keystore.

Generate the Worker secret with:

```bash
openssl rand -base64 32
```

and store it with:

```bash
npx wrangler secret put BIOMETRIC_ENCRYPTION_KEY
```

Do not rotate this secret without a biometric-template migration/re-enrollment plan; existing encrypted templates require the same key to decrypt.

## FACE model

From `attendance-mobile/`:

```bash
npm run face:model:install
```

The installer verifies the pinned Git blob before installing `android/app/src/main/assets/facenet.tflite`. The model contract used by Ledgerly is 160x160 RGB float input -> 128 float embedding output.

## Phone/printed-image test mode

Administrators may temporarily allow a screen-displayed face, printed photograph, or both for testing. A reason and expiry are required. The kiosk shows a prominent warning and bypasses the liveness challenge only while the grant is active.

Test FACE events are `TEST` and `official=0`; they do not change real attendance totals. Test mode cannot create official biometric enrollment.

## Fallback methods

FACE is not mandatory. QR/barcode, NFC and supervised person lookup remain available if the model is missing, camera quality is poor, liveness fails or a match is uncertain.

## Offline integrity

Offline sync batches and client events are idempotent. Accepted/duplicate events leave the local queue; explicitly rejected events move to a quarantine queue so they are neither lost nor retried forever.
