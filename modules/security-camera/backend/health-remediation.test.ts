import {describe,expect,it} from "vitest";
import {scoreCameraHealth} from "./health-remediation";

const now=Date.parse("2026-09-09T03:00:00Z");
const iso=(secondsAgo:number)=>new Date(now-secondsAgo*1000).toISOString();
const base=()=>({id:"cam1",organization_id:"org1",lifecycle_status:"active",last_seen_at:iso(10),paired_at:iso(3600),recording_enabled:1,last_recording_at:iso(120),server_id:"srv1",server_status:"online",server_last_seen_at:iso(10),stream_status:"online",last_stream_at:iso(10),appliance_running:1,wake_lock:1,device_owner:1,charging:1,battery_level:85,temperature_c:36,thermal_status:0,pending_segments:0,spool_bytes:0,spool_free_bytes:2*1024*1024*1024,buffer_pressure:0,diagnostics_updated_at:iso(10),capture_paused:0,nvr_reachability:"online"});

describe("security camera health scoring",()=>{
 it("keeps a healthy camera near full score",()=>{const r=scoreCameraHealth(base(),now);expect(r.state).toBe("healthy");expect(r.score).toBe(100);expect(r.classification).toBe("online")});
 it("marks a long-offline camera critical",()=>{const r=scoreCameraHealth({...base(),last_seen_at:iso(300)},now);expect(r.state).toBe("critical");expect(r.issues.some(x=>x.code==="camera-offline")).toBe(true)});
 it("distinguishes an NVR outage from a camera outage",()=>{const r=scoreCameraHealth({...base(),server_status:"offline",server_last_seen_at:iso(240),stream_status:"failed"},now);expect(r.classification).toBe("nvr-offline");expect(r.issues.some(x=>x.code==="nvr-offline")).toBe(true)});
 it("flags stale recording independently of heartbeat",()=>{const r=scoreCameraHealth({...base(),last_recording_at:iso(900)},now);expect(r.state).toBe("critical");expect(r.issues.some(x=>x.code==="recording-stale")).toBe(true)});
 it("suppresses operational faults while lifecycle is maintenance",()=>{const r=scoreCameraHealth({...base(),lifecycle_status:"maintenance",last_seen_at:iso(9999)},now);expect(r.state).toBe("maintenance");expect(r.issues).toHaveLength(0)});
 it("penalizes thermal and local storage pressure",()=>{const r=scoreCameraHealth({...base(),temperature_c:49,thermal_status:4,buffer_pressure:1,spool_free_bytes:200*1024*1024},now);expect(r.state).toBe("critical");expect(r.issues.map(x=>x.code)).toEqual(expect.arrayContaining(["thermal-critical","buffer-pressure"]))});
});
