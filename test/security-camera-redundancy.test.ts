import {describe,expect,it} from "vitest";
import {decideFailover} from "../modules/security-camera/backend/redundancy-policy";
const NOW=Date.parse("2026-09-09T01:20:00Z");
const ago=(seconds:number)=>new Date(NOW-seconds*1000).toISOString();

describe("security camera NVR redundancy policy",()=>{
 it("fails over when primary is stale and secondary is healthy",()=>{const d=decideFailover({state:"primary",primaryStatus:"online",primaryLastSeenAt:ago(180),secondaryStatus:"online",secondaryLastSeenAt:ago(10),failoverAfterSeconds:90,failbackEnabled:true,failbackAfterSeconds:300,nowMs:NOW});expect(d.action).toBe("failover")});
 it("reports degraded when both NVRs are stale",()=>{const d=decideFailover({state:"primary",primaryStatus:"offline",primaryLastSeenAt:ago(500),secondaryStatus:"offline",secondaryLastSeenAt:ago(500),failoverAfterSeconds:90,failbackEnabled:true,failbackAfterSeconds:300,nowMs:NOW});expect(d.action).toBe("degraded")});
 it("starts a recovery window before automatic failback",()=>{const d=decideFailover({state:"secondary",primaryStatus:"online",primaryLastSeenAt:ago(10),secondaryStatus:"online",secondaryLastSeenAt:ago(10),failoverAfterSeconds:90,failbackEnabled:true,failbackAfterSeconds:300,nowMs:NOW});expect(d.action).toBe("begin_primary_recovery")});
 it("does not fail back before stability threshold",()=>{const d=decideFailover({state:"secondary",primaryStatus:"online",primaryLastSeenAt:ago(10),secondaryStatus:"online",secondaryLastSeenAt:ago(10),failoverAfterSeconds:90,failbackEnabled:true,failbackAfterSeconds:300,primaryHealthySince:ago(120),nowMs:NOW});expect(d.action).toBe("none")});
 it("fails back after the primary is stable long enough",()=>{const d=decideFailover({state:"secondary",primaryStatus:"online",primaryLastSeenAt:ago(10),secondaryStatus:"online",secondaryLastSeenAt:ago(10),failoverAfterSeconds:90,failbackEnabled:true,failbackAfterSeconds:300,primaryHealthySince:ago(360),nowMs:NOW});expect(d.action).toBe("failback")});
 it("returns immediately to primary if secondary fails after primary recovers",()=>{const d=decideFailover({state:"secondary",primaryStatus:"online",primaryLastSeenAt:ago(10),secondaryStatus:"offline",secondaryLastSeenAt:ago(500),failoverAfterSeconds:90,failbackEnabled:true,failbackAfterSeconds:300,nowMs:NOW});expect(d.action).toBe("failback")});
 it("stays on healthy secondary when automatic failback is disabled",()=>{const d=decideFailover({state:"secondary",primaryStatus:"online",primaryLastSeenAt:ago(10),secondaryStatus:"online",secondaryLastSeenAt:ago(10),failoverAfterSeconds:90,failbackEnabled:false,failbackAfterSeconds:300,nowMs:NOW});expect(d.action).toBe("none")});
});
