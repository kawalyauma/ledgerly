// @ts-nocheck
import{Hono}from'hono';
import type{AppVariables,Env}from'../../../src/types';
import{requireModuleEnabled}from'../../../src/lib/modules';
import{securityRead,securityExport,securityManage,securityReview}from'./security-scope';
import{auditFromContext}from'./audit';
import*as F from'./forensic-service';
import*as V from'./export-verification-service';
import{assertForensicWindow}from'./forensic-validation';
export const securityCameraForensicRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled('security-camera'),securityRead],manage=[requireModuleEnabled('security-camera'),securityManage],exportScope=[requireModuleEnabled('security-camera'),securityExport],review=[requireModuleEnabled('security-camera'),securityReview];
securityCameraForensicRoutes.get('/forensics/holds',...read,async c=>c.json({data:await F.listHolds(c.env.FINANCE_DB,c.get('principal').organizationId)}));
securityCameraForensicRoutes.post('/forensics/holds',...manage,async c=>{const p=c.get('principal'),body=await json(c),data=await F.createHold(c.env.FINANCE_DB,p.organizationId,p.userId,body);await auditFromContext(c,'forensics.legal_hold.created','legal-hold',data.id,{cameraId:data.cameraId,incidentId:data.incidentId,from:data.from,to:data.to});return c.json({data},201)});
securityCameraForensicRoutes.post('/forensics/holds/:id/release',...manage,async c=>{const p=c.get('principal'),data=await F.releaseHold(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param('id'));await auditFromContext(c,'forensics.legal_hold.released','legal-hold',c.req.param('id'));return c.json({data})});
securityCameraForensicRoutes.get('/forensics/custody',...review,async c=>c.json({data:await F.listCustody(c.env.FINANCE_DB,c.get('principal').organizationId,c.req.query('type')||undefined,c.req.query('id')||undefined)}));
securityCameraForensicRoutes.post('/cameras/:id/forensic-export',...exportScope,async c=>{const p=c.get('principal'),body=await json(c),cameraId=c.req.param('id');await assertForensicWindow(c.env.FINANCE_DB,p.organizationId,cameraId,body);const data=await F.createForensicExport(c.env.FINANCE_DB,p.organizationId,p.userId,cameraId,{...body,allowCompromised:true},c.env.SECURITY_EVIDENCE_SIGNING_KEY);await auditFromContext(c,'forensics.export.requested','export',data.id,{cameraId,manifestSha256:data.manifestSha256,sourceSegments:data.sourceSegments,signingStatus:data.signingStatus});return c.json({data},201)});
securityCameraForensicRoutes.get('/forensics/exports/:id/manifest',...review,async c=>{const p=c.get('principal'),data=await F.getExportManifest(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param('id'));await auditFromContext(c,'forensics.manifest.viewed','export',c.req.param('id'),{verificationStatus:data.verificationStatus});return c.json({data})});
securityCameraForensicRoutes.post('/forensics/exports/:id/verify-copy',...review,async c=>{const p=c.get('principal'),data=await V.verifyExportCopy(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param('id'),await json(c));await auditFromContext(c,'forensics.export.copy_verified','export',c.req.param('id'),{matched:data.matched});return c.json({data})});
