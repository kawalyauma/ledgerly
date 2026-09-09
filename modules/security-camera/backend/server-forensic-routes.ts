// @ts-nocheck
import{Hono}from'hono';
import type{AppVariables,Env}from'../../../src/types';
import*as F from'./forensic-service';
export const securityCameraServerForensicRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
function auth(c:any){const raw=c.req.header('Authorization')||'',m=/^Server\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:m?.[1]||'',credential:m?.[2]||''}}
securityCameraServerForensicRoutes.get('/server/forensics/config',async c=>{const a=auth(c);try{return c.json({data:await F.serverForensicsConfig(c.env.FINANCE_DB,a.id,a.credential)})}catch(error){return c.json({error:{code:'CAMERA_FORENSICS_AUTH_FAILED',message:error instanceof Error?error.message:'Camera server authentication failed'}},401)}});
securityCameraServerForensicRoutes.post('/server/forensics/exports/:id/finalize',async c=>{const a=auth(c);try{return c.json({data:await F.finalizeExport(c.env.FINANCE_DB,a.id,a.credential,c.req.param('id'),await json(c))})}catch(error){return c.json({error:{code:'CAMERA_FORENSIC_EXPORT_FAILED',message:error instanceof Error?error.message:'Forensic export verification failed'}},400)}});
