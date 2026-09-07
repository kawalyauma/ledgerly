// @ts-nocheck
import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables,Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { randomToken,sha256 } from "../../../src/lib/crypto";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { requireScope } from "../../../src/lib/auth";
import { schoolPermission } from "../../school/backend/common";

const ENROLLMENT_MINUTES=10;

async function issueEnrollment(db:D1Database,organizationId:string,deviceId:string,userId:string){
  await db.prepare("UPDATE att_device_enrollment_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE organization_id=? AND device_id=? AND consumed_at IS NULL").bind(organizationId,deviceId).run();
  const token=randomToken(32),id=createId("ade"),expiresAt=new Date(Date.now()+ENROLLMENT_MINUTES*60_000).toISOString();
  await db.prepare("INSERT INTO att_device_enrollment_tokens(id,organization_id,device_id,token_hash,expires_at,created_by) VALUES (?,?,?,?,?,?)").bind(id,organizationId,deviceId,await sha256(token),expiresAt,userId).run();
  return {enrollmentToken:token,enrollmentExpiresAt:expiresAt};
}

export const attendanceKioskEnrollmentRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
attendanceKioskEnrollmentRoutes.use("*",requireModuleEnabled("school-management"));
attendanceKioskEnrollmentRoutes.use("*",requireModuleEnabled("attendance"));
attendanceKioskEnrollmentRoutes.use("*",requireScope("school:read"));
attendanceKioskEnrollmentRoutes.use("*",schoolPermission("attendance:devices"));

attendanceKioskEnrollmentRoutes.post("/",async c=>{
  const p=c.get("principal"),v=await c.req.json<Record<string,any>>().catch(()=>({}));
  if(!String(v.name||"").trim())throw new AppError(422,"VALIDATION_ERROR","Kiosk name is required");
  const db=c.env.FINANCE_DB,id=createId("atd"),count=await db.prepare("SELECT COUNT(*) n FROM att_devices WHERE organization_id=?").bind(p.organizationId).first<{n:number}>(),code=`ATT-${String(Number(count?.n||0)+1).padStart(6,"0")}`;
  await db.prepare("INSERT INTO att_devices(id,organization_id,device_code,name,location_name,campus_id,population,direction,status,registered_by) VALUES (?,?,?,?,?,?,?,?,'pending',?)").bind(id,p.organizationId,code,String(v.name).trim(),String(v.locationName||"").trim()||null,v.campusId||null,["students","staff","mixed"].includes(v.population)?v.population:"mixed",["IN","OUT","BOTH"].includes(v.direction)?v.direction:"BOTH",p.userId).run();
  const enrollment=await issueEnrollment(db,p.organizationId,id,p.userId);
  await db.prepare("INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json) VALUES (?,?,'user',?,'device.enrollment.created','attendance_device',?,?)").bind(createId("ata"),p.organizationId,p.userId,id,JSON.stringify({deviceCode:code,expiresAt:enrollment.enrollmentExpiresAt})).run();
  return c.json({data:{id,deviceCode:code,name:String(v.name).trim(),status:"pending",...enrollment,note:"Scan this one-time QR code on the Android kiosk before it expires."}},201);
});

attendanceKioskEnrollmentRoutes.post("/:id/refresh",async c=>{
  const p=c.get("principal"),db=c.env.FINANCE_DB,id=c.req.param("id"),device=await db.prepare("SELECT id,device_code deviceCode,name,status FROM att_devices WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<any>();
  if(!device)throw new AppError(404,"ATTENDANCE_DEVICE_NOT_FOUND","Attendance kiosk not found");
  if(device.status!=="pending")throw new AppError(409,"KIOSK_ALREADY_REGISTERED","Only a pending kiosk can receive a new enrollment QR code");
  const enrollment=await issueEnrollment(db,p.organizationId,id,p.userId);
  await db.prepare("INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json) VALUES (?,?,'user',?,'device.enrollment.refreshed','attendance_device',?,?)").bind(createId("ata"),p.organizationId,p.userId,id,JSON.stringify({expiresAt:enrollment.enrollmentExpiresAt})).run();
  return c.json({data:{id,deviceCode:device.deviceCode,name:device.name,status:"pending",...enrollment}});
});

export const attendanceDeviceEnrollmentRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
attendanceDeviceEnrollmentRoutes.post("/",async c=>{
  const parsed=z.object({token:z.string().min(20).max(200),appVersion:z.string().min(1).max(60).optional()}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid kiosk enrollment request",parsed.error.flatten());
  const db=c.env.FINANCE_DB,tokenHash=await sha256(parsed.data.token),row=await db.prepare(`
    SELECT e.id enrollment_id,e.organization_id,e.device_id,d.device_code,d.name
    FROM att_device_enrollment_tokens e
    JOIN att_devices d ON d.id=e.device_id AND d.organization_id=e.organization_id
    JOIN organization_modules om ON om.organization_id=e.organization_id AND om.module_key='attendance' AND om.enabled=1
    WHERE e.token_hash=? AND e.consumed_at IS NULL AND e.expires_at>CURRENT_TIMESTAMP AND d.status='pending'
    LIMIT 1
  `).bind(tokenHash).first<any>();
  if(!row)throw new AppError(401,"INVALID_ENROLLMENT_QR","This kiosk QR code is invalid, expired or already used");
  const claimed=await db.prepare("UPDATE att_device_enrollment_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP").bind(row.enrollment_id).run();
  if(!claimed.meta.changes)throw new AppError(409,"ENROLLMENT_ALREADY_USED","This kiosk QR code has already been used");
  const credential=randomToken(32),credentialHash=await sha256(credential);
  await db.batch([
    db.prepare("UPDATE att_device_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE organization_id=? AND device_id=? AND revoked_at IS NULL").bind(row.organization_id,row.device_id),
    db.prepare("INSERT INTO att_device_credentials(id,organization_id,device_id,credential_hash) VALUES (?,?,?,?)").bind(createId("adc"),row.organization_id,row.device_id,credentialHash),
    db.prepare("UPDATE att_devices SET status='active',app_version=?,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending'").bind(parsed.data.appVersion||null,row.device_id,row.organization_id),
    db.prepare("INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json) VALUES (?,?,'device',?,'device.enrolled','attendance_device',?,?)").bind(createId("ata"),row.organization_id,row.device_id,row.device_id,JSON.stringify({method:"qr",appVersion:parsed.data.appVersion||null}))
  ]);
  return c.json({data:{deviceId:row.device_id,deviceCode:row.device_code,name:row.name,credential,status:"active"}},201);
});
