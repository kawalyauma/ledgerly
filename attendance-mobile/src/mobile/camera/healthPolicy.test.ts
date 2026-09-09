import {describe,expect,it} from "vitest";
import {EMPTY_CAMERA_PROTECTION,classifyNvrReachability,nextCameraProtection} from "./healthPolicy";

describe("camera protection policy",()=>{
 it("latches severe heat until the phone is safely cooler",()=>{
  const hot=nextCameraProtection(EMPTY_CAMERA_PROTECTION,{running:true,wakeLock:true,temperatureC:49,thermalStatus:4},{recording:false,uploading:false,pendingSegments:0});expect(hot.paused).toBe(true);expect(hot.reason).toBe("thermal");
  const still=nextCameraProtection(hot,{running:true,wakeLock:true,temperatureC:44,thermalStatus:3},{recording:false,uploading:false,pendingSegments:0});expect(still.thermal).toBe(true);
  const cool=nextCameraProtection(still,{running:true,wakeLock:true,temperatureC:42,thermalStatus:2},{recording:false,uploading:false,pendingSegments:0});expect(cool.paused).toBe(false);
 });
 it("protects a critically low unplugged battery with recovery hysteresis",()=>{
  const low=nextCameraProtection(EMPTY_CAMERA_PROTECTION,{running:true,wakeLock:true,batteryLevel:9,charging:false},{recording:false,uploading:false,pendingSegments:0});expect(low.reason).toBe("low-battery");
  expect(nextCameraProtection(low,{running:true,wakeLock:true,batteryLevel:15,charging:false},{recording:false,uploading:false,pendingSegments:0}).paused).toBe(true);
  expect(nextCameraProtection(low,{running:true,wakeLock:true,batteryLevel:11,charging:true},{recording:false,uploading:false,pendingSegments:0}).paused).toBe(false);
 });
 it("stops fallback capture before storage exhaustion",()=>{
  const pressured=nextCameraProtection(EMPTY_CAMERA_PROTECTION,{running:true,wakeLock:true},{recording:false,uploading:false,pendingSegments:175,spoolFreeBytes:200*1024*1024,bufferPressure:true});expect(pressured.reason).toBe("storage");
  const recovered=nextCameraProtection(pressured,{running:true,wakeLock:true},{recording:false,uploading:false,pendingSegments:2,spoolFreeBytes:900*1024*1024,bufferPressure:false});expect(recovered.paused).toBe(false);
 });
 it("classifies live and fallback NVR paths",()=>{
  expect(classifyNvrReachability({assigned:false,whipStatus:"idle"})).toBe("unassigned");
  expect(classifyNvrReachability({assigned:true,whipStatus:"online"})).toBe("online");
  expect(classifyNvrReachability({assigned:true,whipStatus:"failed",lastUploadedAt:new Date().toISOString()})).toBe("fallback-ingest");
  expect(classifyNvrReachability({assigned:true,whipStatus:"failed",mediaStatus:"offline"})).toBe("nvr-media-offline");
 });
});
