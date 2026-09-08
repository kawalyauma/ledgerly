import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import { sha256 } from "../../../src/lib/crypto";
import type { AuthPrincipal } from "../../../src/types";
import type { MobileSyncMutationContext } from "../../mobile-sync/backend/contracts";
import * as S from "./service";

export type R = Record<string, any>;

export const eventPayload = z.object({
  personType: z.enum(["student", "staff"]),
  personId: z.string().min(3).max(120),
  direction: z.enum(["IN", "OUT"]),
  method: z.enum(S.methods),
  verificationMode: z.enum(["STANDARD", "TEST", "SUPERVISED", "UNVERIFIED"]).default("STANDARD"),
  confidence: z.number().min(0).max(1).optional(),
  matchMargin: z.number().min(0).max(2).optional(),
  livenessScore: z.number().min(0).max(1).optional(),
  capturedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function asIso(value: unknown) {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new AppError(422, "INVALID_CAPTURE_TIME", "Attendance capture time is invalid");
  if (d.getTime() > Date.now() + 48 * 60 * 60 * 1000)
    throw new AppError(422, "DEVICE_CLOCK_AHEAD", "Attendance capture time is more than 48 hours ahead of server time");
  if (d.getTime() < Date.now() - 5 * 366 * 24 * 60 * 60 * 1000)
    throw new AppError(422, "CAPTURE_TOO_OLD", "Attendance events older than five years require administrative import");
  return d.toISOString();
}

export function localParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === name)?.value ?? "";
  return { day: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}
export function hhmm(value: string) { const m = /^(\d{1,2}):(\d{2})/.exec(value); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
export async function stableId(prefix: string, ...parts: string[]) { return `${prefix}_${(await sha256(parts.join("|"))).slice(0, 32)}`; }
export const js = (value: unknown) => JSON.stringify(value ?? {});

export async function hasPermission(db: D1Database, p: AuthPrincipal, permission: string) {
  if (p.role === "owner" || p.role === "admin") return true;
  if (p.scopes.includes(permission) || p.scopes.includes("school:*") ||
      (p.scopes.includes("school:write") && permission.endsWith(":write"))) return true;
  const row = await db.prepare(`SELECT 1 FROM school_user_roles ur
    JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
    WHERE ur.organization_id=? AND ur.user_id=? AND rp.permission=? AND rp.effect='allow'
      AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP)
      AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP)
    UNION ALL
    SELECT 1 FROM school_temporary_permissions tp
    WHERE tp.organization_id=? AND tp.user_id=? AND tp.permission=? AND tp.revoked_at IS NULL
      AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP LIMIT 1`)
    .bind(p.organizationId,p.userId,permission,p.organizationId,p.userId,permission).first();
  return Boolean(row);
}

export async function requireAttendanceWrite(c: MobileSyncMutationContext) {
  if (!await hasPermission(c.db, c.principal, "attendance:write"))
    throw new AppError(403, "FORBIDDEN", "Missing school permission: attendance:write");
}

export function auditStmt(db:D1Database,org:string,deviceId:string,eventId:string,action:string,details:unknown) {
  return db.prepare(`INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json)
    VALUES (lower(hex(randomblob(16))),?,'device',?,?,'attendance_event',?,?)`)
    .bind(org,deviceId,action,eventId,js(details));
}
export function issueStmt(db:D1Database,x:{organizationId:string;eventId:string;personType:string;personId:string;attendanceDate:string;reasonCode:string;details:unknown}) {
  return db.prepare(`INSERT INTO att_mobile_reconciliation_issues
    (id,organization_id,event_id,person_type,person_id,attendance_date,reason_code,details_json,status)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?,?,'pending')
    ON CONFLICT(event_id) DO UPDATE SET reason_code=excluded.reason_code,details_json=excluded.details_json,status='pending',updated_at=CURRENT_TIMESTAMP`)
    .bind(x.organizationId,x.eventId,x.personType,x.personId,x.attendanceDate,x.reasonCode,js(x.details));
}

export function rawEventStmt(db:D1Database,x:{
  eventId:string;organizationId:string;mobileDeviceId:string;personType:"student"|"staff";personId:string;
  direction:"IN"|"OUT";method:string;verificationMode:string;verificationStatus:"verified"|"rejected"|"duplicate";
  confidence?:number|null;livenessScore?:number|null;capturedAt:string;official:number;
  recordLookup?:{attendanceDate:string;sessionId?:string|null};metadata:unknown;userId:string;
}) {
  let recordSql="NULL";
  const binds:unknown[]=[x.eventId,x.organizationId,x.mobileDeviceId,x.eventId,x.personType,x.personId,x.direction,x.method,
    x.verificationMode,x.verificationStatus,x.confidence??null,x.livenessScore??null,x.capturedAt,x.official];
  if(x.recordLookup){
    if(x.personType==="student"){
      recordSql=`(SELECT id FROM att_records WHERE organization_id=? AND session_id=? AND person_type='student' AND person_id=? LIMIT 1)`;
      binds.push(x.organizationId,x.recordLookup.sessionId??null,x.personId);
    }else{
      recordSql=`(SELECT id FROM att_records WHERE organization_id=? AND attendance_date=? AND person_type='staff' AND person_id=? AND session_id IS NULL LIMIT 1)`;
      binds.push(x.organizationId,x.recordLookup.attendanceDate,x.personId);
    }
  }
  binds.push(js(x.metadata),x.userId);
  return db.prepare(`INSERT INTO att_events
    (id,organization_id,device_id,mobile_sync_device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,
     verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,record_id,metadata_json,created_by)
    VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ${recordSql}, ?, ?)`).bind(...binds);
}
