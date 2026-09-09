export type FailoverState="primary"|"secondary";
export type FailoverDecision={action:"none"|"failover"|"begin_primary_recovery"|"clear_primary_recovery"|"failback"|"degraded";reason:string;primaryHealthy:boolean;secondaryHealthy:boolean;primaryAgeSeconds:number;secondaryAgeSeconds:number};
export function heartbeatAgeSeconds(lastSeenAt:string|null|undefined,nowMs=Date.now()){const t=Date.parse(lastSeenAt||"");return Number.isFinite(t)?Math.max(0,(nowMs-t)/1000):Infinity}
export function isServerHealthy(status:string,lastSeenAt:string|null|undefined,thresholdSeconds:number,nowMs=Date.now()){return status==="online"&&heartbeatAgeSeconds(lastSeenAt,nowMs)<=Math.max(30,thresholdSeconds)}
export function decideFailover(input:{state:FailoverState;primaryStatus:string;primaryLastSeenAt?:string|null;secondaryStatus:string;secondaryLastSeenAt?:string|null;failoverAfterSeconds:number;failbackEnabled:boolean;failbackAfterSeconds:number;primaryHealthySince?:string|null;nowMs?:number}):FailoverDecision{
 const now=input.nowMs??Date.now(),threshold=Math.max(30,input.failoverAfterSeconds||90),primaryAgeSeconds=heartbeatAgeSeconds(input.primaryLastSeenAt,now),secondaryAgeSeconds=heartbeatAgeSeconds(input.secondaryLastSeenAt,now),primaryHealthy=isServerHealthy(input.primaryStatus,input.primaryLastSeenAt,threshold,now),secondaryHealthy=isServerHealthy(input.secondaryStatus,input.secondaryLastSeenAt,threshold,now);
 if(input.state!=="secondary"){
  if(!primaryHealthy&&secondaryHealthy)return{action:"failover",reason:`Primary NVR unavailable for ${Math.round(primaryAgeSeconds)} seconds`,primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
  if(!primaryHealthy&&!secondaryHealthy)return{action:"degraded",reason:"Primary and secondary NVRs are both unavailable",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
  return{action:"none",reason:"Primary NVR healthy",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 }
 if(!primaryHealthy&&!secondaryHealthy)return{action:"degraded",reason:"Primary and secondary NVRs are both unavailable",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 if(!primaryHealthy)return{action:input.primaryHealthySince?"clear_primary_recovery":"none",reason:"Secondary NVR active; primary is still unavailable",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 if(!secondaryHealthy)return{action:"failback",reason:"Secondary NVR unavailable; restoring the healthy primary immediately",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 if(!input.failbackEnabled)return{action:"none",reason:"Primary recovered; automatic failback disabled",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 if(!input.primaryHealthySince)return{action:"begin_primary_recovery",reason:"Primary NVR recovered; starting failback stability window",primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 const recoveredAt=Date.parse(input.primaryHealthySince),stableSeconds=Number.isFinite(recoveredAt)?Math.max(0,(now-recoveredAt)/1000):0;if(stableSeconds>=Math.max(60,input.failbackAfterSeconds||300))return{action:"failback",reason:`Primary NVR healthy for ${Math.round(stableSeconds)} seconds`,primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
 return{action:"none",reason:`Primary recovery stability window ${Math.round(stableSeconds)}/${Math.max(60,input.failbackAfterSeconds||300)} seconds`,primaryHealthy,secondaryHealthy,primaryAgeSeconds,secondaryAgeSeconds};
}
