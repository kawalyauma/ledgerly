# Ledgerly Attendance Mobile 1.2

React Native + TypeScript Android kiosk client for the standalone Ledgerly Attendance module.

## Camera scope

The kiosk intentionally supports **only the Android phone/tablet built-in camera** through `react-native-vision-camera`.

Supported capture methods:
- FACE through the built-in device camera
- QR/barcode through the same camera
- NFC where the device supports it
- supervised admission/staff-number lookup

Not supported:
- USB/UVC cameras
- IP cameras
- RTSP/ONVIF streams
- external capture cards

The front camera is preferred and the rear camera may be selected on devices with both.

## Face recognition

FACE is fully on-device:

```text
device camera
  -> ML Kit face detection / eye state / head angle
  -> quality gate
  -> active challenge (eyes closed or head turn)
  -> FaceNet 160x160 embedding
  -> local encrypted 1:N template search
  -> match threshold + ambiguity margin
  -> attendance event
```

If FACE is unavailable or uncertain, the kiosk fails closed and QR, NFC and supervised lookup remain usable.

Before building FACE support:

```bash
npm run face:model:install
```

See `FACE_MODEL_SETUP.md`.

## Enrollment and template sync

An administrator starts enrollment from Attendance -> Biometrics and selects a person plus an active kiosk. The kiosk captures three live device-camera samples, performs the liveness challenge, creates the face embedding locally, and uploads only the mathematical embedding.

The Worker encrypts templates using `BIOMETRIC_ENCRYPTION_KEY`. Authorized kiosks receive the decrypted templates over their authenticated HTTPS device channel and store them encrypted with Android Keystore-backed storage. Raw enrollment photos are not uploaded as the recognition database.

## Test spoof mode

An Attendance administrator can temporarily enable:
- a face shown on another phone/screen;
- a printed photograph;
- or both.

The grant expires automatically and is displayed prominently. FACE events made under the grant are `TEST` events and remain unofficial. Test mode never creates an official biometric enrollment.

## Offline queue

Attendance events are encrypted locally. Network failures stay pending and retry automatically. Server-rejected events are quarantined locally rather than silently disappearing or retrying forever.

## Development

```bash
npm install
npm run face:model:install
npm run typecheck
npm run android
```

Use a real Android device for camera, NFC, liveness and kiosk testing.
