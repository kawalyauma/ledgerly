# Ledgerly Attendance FaceNet model

The Android FaceEngine expects:

```text
android/app/src/main/assets/facenet.tflite
```

Install it from `attendance-mobile/`:

```bash
npm run face:model:install
```

The installer downloads the pinned FaceNet TFLite asset and verifies the exact Git blob before writing it into the Android assets folder.

Model contract used by Ledgerly:

```text
input:  1 x 160 x 160 x 3 RGB float32
output: 1 x 128 float embedding
```

Ledgerly uses ML Kit for face detection/classification and a FaceNet-compatible model for identity embeddings. The kiosk normalizes embeddings and performs local cosine similarity matching.

For production, validate the configured thresholds on the exact school devices and population. FACE must reject uncertain or ambiguous matches instead of lowering thresholds simply to increase the apparent recognition rate.
