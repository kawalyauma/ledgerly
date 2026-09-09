#!/usr/bin/env python3
"""Optional local person/object detector for Ledgerly Camera Server.

Reads assigned streams from local MediaMTX RTSP and submits metadata-only detections
to camera-server. Frames stay on this NVR. A local Ultralytics-compatible model is
required. Detector media reads and event submission use separate secrets.
"""
import os,time,json
from urllib.parse import urlsplit,urlunsplit,quote
import cv2,requests
from ultralytics import YOLO
CONTROL=os.getenv("CAMERA_CONTROL_URL","http://127.0.0.1:8789").rstrip("/")
RTSP_BASE=os.getenv("CAMERA_RTSP_BASE","rtsp://127.0.0.1:8554").rstrip("/")
RTSP_USER=os.getenv("CAMERA_RTSP_USER","ledgerly-detector")
MODEL=os.getenv("CAMERA_DETECTOR_MODEL","").strip();EVENT_KEY=os.getenv("CAMERA_EVENT_KEY","").strip();MEDIA_KEY=os.getenv("CAMERA_DETECTOR_MEDIA_KEY","").strip()
CONF=float(os.getenv("CAMERA_DETECTOR_CONFIDENCE","0.55"));INTERVAL=max(.25,float(os.getenv("CAMERA_DETECTOR_INTERVAL_SECONDS","1.0")));COOLDOWN=max(2,float(os.getenv("CAMERA_DETECTOR_COOLDOWN_SECONDS","10")))
OBJECT_CLASSES={x.strip().lower() for x in os.getenv("CAMERA_DETECTOR_OBJECT_CLASSES","person,car,bus,truck,motorcycle,bicycle").split(",") if x.strip()}
if not MODEL:raise SystemExit("CAMERA_DETECTOR_MODEL must point to a local .pt/.onnx model")
if not EVENT_KEY:raise SystemExit("CAMERA_EVENT_KEY is required for detector event submission")
if not MEDIA_KEY:raise SystemExit("CAMERA_DETECTOR_MEDIA_KEY is required for authenticated detector media reads")
model=YOLO(MODEL);session=requests.Session();last={};captures={}
def rtsp(camera_id):
    u=urlsplit(RTSP_BASE);host=u.hostname or "127.0.0.1";port=f":{u.port}" if u.port else "";netloc=f"{quote(RTSP_USER,safe='')}:{quote(MEDIA_KEY,safe='')}@{host}{port}";base=urlunsplit((u.scheme,netloc,u.path.rstrip('/'),"",""));return f"{base}/{camera_id}"
def assignments():
    try:
        body=session.get(f"{CONTROL}/v1/assignments",timeout=4).json();return [str(c["id"]) for c in body.get("data",{}).get("cameras",[]) if c.get("recordingEnabled",True)]
    except Exception as exc:print(f"[detector] assignments: {exc}",flush=True);return []
def post(camera_id,event_type,confidence,label,box):
    now=time.time();key=(camera_id,event_type,label)
    if now-last.get(key,0)<COOLDOWN:return
    headers={"Content-Type":"application/json","X-Ledgerly-Event-Key":EVENT_KEY};payload={"cameraId":camera_id,"eventType":event_type,"confidence":float(confidence),"source":"local-ultralytics","message":f"{label.title()} detected","metadata":{"objectClass":label,"box":box,"detectorModel":os.path.basename(MODEL)}}
    try:r=session.post(f"{CONTROL}/v1/events",headers=headers,data=json.dumps(payload),timeout=5);r.raise_for_status();last[key]=now
    except Exception as exc:print(f"[detector] event {camera_id}: {exc}",flush=True)
def capture(camera_id):
    cap=captures.get(camera_id)
    if cap is None or not cap.isOpened():
        if cap is not None:cap.release()
        cap=cv2.VideoCapture(rtsp(camera_id));captures[camera_id]=cap
    return cap
print(f"[detector] model={MODEL} control={CONTROL}",flush=True)
while True:
    active=set(assignments())
    for stale in list(captures):
        if stale not in active:captures.pop(stale).release()
    for camera_id in active:
        cap=capture(camera_id);ok,frame=cap.read()
        if not ok:cap.release();captures.pop(camera_id,None);continue
        try:
            result=model.predict(frame,conf=CONF,verbose=False)[0];names=result.names
            for box in result.boxes:
                cls=int(box.cls[0]);label=str(names.get(cls,cls)).lower();confidence=float(box.conf[0])
                if label not in OBJECT_CLASSES:continue
                xy=[round(float(x),1) for x in box.xyxy[0].tolist()];post(camera_id,"person" if label=="person" else "object",confidence,label,xy)
        except Exception as exc:print(f"[detector] inference {camera_id}: {exc}",flush=True)
    time.sleep(INTERVAL)
