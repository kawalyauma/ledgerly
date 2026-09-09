import type{MobileSession}from"../auth";import{ledgerlyRequest,type SessionUpdater}from"../apiClient";import type{CommissioningRun,DeploymentReadiness,RecoveryDrill}from"./commissioningTypes";
type Client={session:MobileSession;onSession?:SessionUpdater};const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,path,init,c.onSession);const json=(method:string,body?:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
export const securityCameraCommissioningApi={
 readiness:(c:Client)=>req<DeploymentReadiness>(c,"/security-camera/readiness"),
 history:(c:Client,limit=100)=>req<CommissioningRun[]>(c,`/security-camera/commissioning-history?limit=${Math.max(1,Math.min(500,limit))}`),
 certify:(c:Client)=>req<DeploymentReadiness>(c,"/security-camera/readiness/certify",json("POST",{})),
 drill:(c:Client)=>req<RecoveryDrill>(c,"/security-camera/recovery-drill",json("POST",{})),
};
