// @ts-nocheck
import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables,Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { sha256 } from "../../../src/lib/crypto";
import * as S from "./service";
import { decryptEmbedding,encryptEmbedding } from "./biometric-crypto";

export const attendanceDeviceRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();

async function authenticate(c:any){
  const auth=c.req.header("Authorization")||"";
  const match=/^Device\s+([^\.\s]+)\.([^\s]+)$/.exec(auth);
  if(!match)throw new AppError(401,"DEVICE_AUTH_REQUIRED","A device credential is required");
  const device=await c.env.FINANCE_DB.prepare(`
    SELECT d.* FROM att_devices d
    JOIN att_device_credentials cr ON cr.device_id=d.id AND cr.organization_id=d.organization_id
    JOIN organization_modules om ON om.organization_id=d.organization_id AND om.module_key='attendance' AND om.enabled=1
    WHERE d.id=? AND d.status='active' AND cr.credential_hash=? AND cr.revoked_at IS NULL
      AND (cr.expires_at IS NULL OR cr.expires_at>CURRENT_TIMESTAMP)
    ORDER BY cr.created_at DESC LIMIT 1
  `).bind(match[1],await sha256(match[2])).first();
  if(!device)throw new AppError(401,"INVALID_DEVICE_CREDENTIAL","Device credential is invalid, expired or revoked");
  await c.env.FINANCE_DB.prepare("UPDATE att_devices SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(device.id).run();
  return device;
}

attendanceDeviceRoutes.get("/health",async c=>{
  const d=await authenticate(c);
  return c.json({data:{deviceId:d.id,deviceCode:d.device_code,status:d.status,serverTime:new Date().toISOString(),cameraSource:"device"}});
});

attendanceDeviceRoutes.get("/bootstrap",async c=>{
  const d=await authenticate(c),population=String(d.population),db=c.env.FINANCE_DB;
  const [studentPolicy,staffPolicy,testMode,students,staff,identifiers]=await Promise.all([
    S.policy(db,d.organization_id,"students"),
    S.policy(db,d.organization_id,"staff"),
    db.prepare("SELECT allow_screen_image,allow_printed_image,expires_at FROM att_test_mode_grants WHERE organization_id=? AND device_id=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP ORDER BY enabled_at DESC LIMIT 1").bind(d.organization_id,d.id).first(),
    population==="staff"?Promise.resolve({results:[]}):db.prepare(`SELECT s.id,s.admission_number,s.student_number,TRIM(s.first_name||' '||s.last_name) name,c.name group_name,b.provider_profile_ref,b.algorithm_version FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN att_biometric_profiles b ON b.organization_id=s.organization_id AND b.person_type='student' AND b.person_id=s.id AND b.status='active' WHERE s.organization_id=? AND s.deleted_at IS NULL AND s.status='active' ORDER BY s.last_name,s.first_name`).bind(d.organization_id).all(),
    population==="students"?Promise.resolve({results:[]}):db.prepare(`SELECT s.id,s.staff_number,TRIM(s.first_name||' '||s.last_name) name,d.name group_name,b.provider_profile_ref,b.algorithm_version FROM school_staff_profiles s LEFT JOIN school_departments d ON d.id=s.department_id LEFT JOIN att_biometric_profiles b ON b.organization_id=s.organization_id AND b.person_type='staff' AND b.person_id=s.id AND b.status='active' WHERE s.organization_id=? AND s.deleted_at IS NULL AND s.employment_status='active' ORDER BY s.last_name,s.first_name`).bind(d.organization_id).all(),
    db.prepare("SELECT person_type,person_id,method,identifier FROM att_person_identifiers WHERE organization_id=? AND active=1").bind(d.organization_id).all()
  ]);
  return c.json({data:{
    generatedAt:new Date().toISOString(),
    device:S.camel(d),
    camera:{source:"device",preferredFacing:"front",allowFacingSwitch:true},
    policies:{students:S.camel(studentPolicy),staff:S.camel(staffPolicy)},
    testMode:testMode?S.camel(testMode):null,
    roster:[...S.camels(students.results),...S.camels(staff.results)],
    identifiers:S.camels(identifiers.results)
  }});
});


attendanceDeviceRoutes.get("/face/state",async c=>{
  const d=await authenticate(c),db=c.env.FINANCE_DB,pop=String(d.population);
  const [settings,job,templateMeta]=await Promise.all([
    db.prepare("SELECT * FROM att_biometric_settings WHERE organization_id=?").bind(d.organization_id).first(),
    db.prepare(`SELECT j.*,COALESCE(TRIM(s.first_name||' '||s.last_name),TRIM(sp.first_name||' '||sp.last_name)) person_name,
      COALESCE(c.name,dep.name) group_name
      FROM att_biometric_enrollment_jobs j
      LEFT JOIN school_students s ON j.person_type='student' AND s.id=j.person_id
      LEFT JOIN school_classes c ON s.current_class_id=c.id
      LEFT JOIN school_staff_profiles sp ON j.person_type='staff' AND sp.id=j.person_id
      LEFT JOIN school_departments dep ON sp.department_id=dep.id
      WHERE j.organization_id=? AND j.device_id=? AND j.status IN ('pending','claimed')
      ORDER BY CASE j.status WHEN 'claimed' THEN 0 ELSE 1 END,j.requested_at LIMIT 1`).bind(d.organization_id,d.id).first(),
    db.prepare(`SELECT SUM(count) count,MAX(version) version FROM (
      SELECT COUNT(*) count,MAX(t.updated_at) version FROM att_biometric_templates t JOIN att_biometric_profiles p ON p.id=t.profile_id
        WHERE t.organization_id=? AND t.active=1 AND p.status='active' AND (?='mixed' OR (?='students' AND t.person_type='student') OR (?='staff' AND t.person_type='staff'))
      UNION ALL
      SELECT COUNT(*) count,MAX(t.updated_at) version FROM att_biometric_template_samples t JOIN att_biometric_profiles p ON p.id=t.profile_id
        WHERE t.organization_id=? AND t.active=1 AND p.status='active' AND (?='mixed' OR (?='students' AND t.person_type='student') OR (?='staff' AND t.person_type='staff'))
    )`).bind(d.organization_id,pop,pop,pop,d.organization_id,pop,pop,pop).first()
  ]);
  return c.json({data:{settings:S.camel(settings||{algorithm_version:'facenet-128-v1',match_threshold:.78,ambiguity_margin:.05,liveness_threshold:.70,quality_threshold:.55}),enrollmentJob:job?S.camel(job):null,templates:{count:Number(templateMeta?.count||0),version:templateMeta?.version||null}}});
});

attendanceDeviceRoutes.get("/face/templates",async c=>{
  const d=await authenticate(c),db=c.env.FINANCE_DB,pop=String(d.population);
  const rows=await db.prepare(`SELECT t.person_type,t.person_id,'primary' sample_id,t.algorithm_version,t.embedding_ciphertext,t.embedding_iv,t.quality_score,t.updated_at
    FROM att_biometric_templates t JOIN att_biometric_profiles p ON p.id=t.profile_id WHERE t.organization_id=? AND t.active=1 AND p.status='active' AND (?='mixed' OR (?='students' AND t.person_type='student') OR (?='staff' AND t.person_type='staff'))
    UNION ALL
    SELECT t.person_type,t.person_id,'pose-'||t.sample_index sample_id,t.algorithm_version,t.embedding_ciphertext,t.embedding_iv,t.quality_score,t.updated_at
    FROM att_biometric_template_samples t JOIN att_biometric_profiles p ON p.id=t.profile_id WHERE t.organization_id=? AND t.active=1 AND p.status='active' AND (?='mixed' OR (?='students' AND t.person_type='student') OR (?='staff' AND t.person_type='staff'))
    ORDER BY person_type,person_id,sample_id`).bind(d.organization_id,pop,pop,pop,d.organization_id,pop,pop,pop).all();
  const templates=await Promise.all((rows.results as any[]).map(async r=>({personType:r.person_type,personId:r.person_id,sampleId:r.sample_id,algorithmVersion:r.algorithm_version,embeddingBase64:await decryptEmbedding(c.env,r.embedding_ciphertext,r.embedding_iv,r.sample_id==='primary'?`${d.organization_id}:${r.person_type}:${r.person_id}:${r.algorithm_version}`:`${d.organization_id}:${r.person_type}:${r.person_id}:${r.algorithm_version}:${r.sample_id}`),qualityScore:r.quality_score,updatedAt:r.updated_at})));
  const version=templates.length?String(Math.max(...(rows.results as any[]).map(r=>Date.parse(r.updated_at)||0))):"0";
  return c.json({data:{version,count:templates.length,replaceAll:true,templates}});
});

attendanceDeviceRoutes.post("/face/enrollment-jobs/:id/claim",async c=>{
  const d=await authenticate(c),id=c.req.param("id"),db=c.env.FINANCE_DB;
  const job=await db.prepare("SELECT * FROM att_biometric_enrollment_jobs WHERE id=? AND organization_id=? AND device_id=? AND status IN ('pending','claimed')").bind(id,d.organization_id,d.id).first();
  if(!job)throw new AppError(404,"ENROLLMENT_JOB_NOT_FOUND","Enrollment job is unavailable");
  if(job.status==='pending')await db.prepare("UPDATE att_biometric_enrollment_jobs SET status='claimed',claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  return c.json({data:{id,status:"claimed"}});
});

attendanceDeviceRoutes.post("/face/enrollment-jobs/:id/complete",async c=>{
  const d=await authenticate(c),id=c.req.param("id"),db=c.env.FINANCE_DB;
  const parsed=z.object({algorithmVersion:z.string().min(1).max(100),embeddingBase64:z.string().min(16).max(20000),embeddingsBase64:z.array(z.string().min(16).max(20000)).min(3).max(5).optional(),qualityScore:z.number().min(0).max(1),livenessScore:z.number().min(0).max(1),poseCount:z.number().int().min(1).max(12),timings:z.record(z.string(),z.number()).optional()}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid biometric enrollment result",parsed.error.flatten());
  const job:any=await db.prepare("SELECT * FROM att_biometric_enrollment_jobs WHERE id=? AND organization_id=? AND device_id=? AND status IN ('pending','claimed')").bind(id,d.organization_id,d.id).first();
  if(!job)throw new AppError(404,"ENROLLMENT_JOB_NOT_FOUND","Enrollment job is unavailable");
  const settings:any=await db.prepare("SELECT * FROM att_biometric_settings WHERE organization_id=?").bind(d.organization_id).first();
  const minQ=Number(settings?.quality_threshold??.55),minL=Number(settings?.liveness_threshold??.70),v=parsed.data;
  if(v.qualityScore<minQ)throw new AppError(422,"FACE_QUALITY_TOO_LOW",`Face quality must be at least ${minQ}`);
  if(v.livenessScore<minL)throw new AppError(422,"LIVENESS_FAILED",`Liveness score must be at least ${minL}`);
  if(v.algorithmVersion!==String(settings?.algorithm_version||'facenet-128-v1'))throw new AppError(409,"FACE_ALGORITHM_MISMATCH","Kiosk face model does not match the school's configured algorithm");
  const secured=await encryptEmbedding(c.env,v.embeddingBase64,`${d.organization_id}:${job.person_type}:${job.person_id}:${v.algorithmVersion}`,v.algorithmVersion==='facenet-128-v1'?512:undefined);
  const samples=await Promise.all((v.embeddingsBase64||[]).map(async(embedding,index)=>({index,secured:await encryptEmbedding(c.env,embedding,`${d.organization_id}:${job.person_type}:${job.person_id}:${v.algorithmVersion}:pose-${index}`,v.algorithmVersion==='facenet-128-v1'?512:undefined)})));
  const existing:any=await db.prepare("SELECT id FROM att_biometric_profiles WHERE organization_id=? AND person_type=? AND person_id=?").bind(d.organization_id,job.person_type,job.person_id).first();
  const profileId=existing?.id||createId("abp"),templateId=createId("abt"),enrollmentId=createId("abe");
  await db.batch([
    db.prepare(`INSERT INTO att_biometric_profiles(id,organization_id,person_type,person_id,provider_profile_ref,algorithm_version,quality_score,consent_status,status,enrolled_by,enrolled_at)
      VALUES (?,?,?,?,?,?,?,?,'active',?,CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id,person_type,person_id) DO UPDATE SET provider_profile_ref=excluded.provider_profile_ref,algorithm_version=excluded.algorithm_version,quality_score=excluded.quality_score,consent_status=excluded.consent_status,status='active',enrolled_by=excluded.enrolled_by,enrolled_at=CURRENT_TIMESTAMP,deleted_at=NULL,updated_at=CURRENT_TIMESTAMP`).bind(profileId,d.organization_id,job.person_type,job.person_id,`local:${profileId}`,v.algorithmVersion,v.qualityScore,job.consent_status,job.requested_by),
    db.prepare(`INSERT INTO att_biometric_templates(id,organization_id,profile_id,person_type,person_id,algorithm_version,embedding_ciphertext,embedding_iv,embedding_bytes,quality_score,liveness_score)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,person_type,person_id) DO UPDATE SET profile_id=excluded.profile_id,algorithm_version=excluded.algorithm_version,embedding_ciphertext=excluded.embedding_ciphertext,embedding_iv=excluded.embedding_iv,embedding_bytes=excluded.embedding_bytes,quality_score=excluded.quality_score,liveness_score=excluded.liveness_score,version=att_biometric_templates.version+1,active=1,updated_at=CURRENT_TIMESTAMP`).bind(templateId,d.organization_id,profileId,job.person_type,job.person_id,v.algorithmVersion,secured.ciphertext,secured.iv,secured.bytes,v.qualityScore,v.livenessScore),
    db.prepare("UPDATE att_biometric_template_samples SET active=0,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND person_type=? AND person_id=?").bind(d.organization_id,job.person_type,job.person_id),
    ...samples.map(x=>db.prepare(`INSERT INTO att_biometric_template_samples(id,organization_id,profile_id,person_type,person_id,sample_index,algorithm_version,embedding_ciphertext,embedding_iv,embedding_bytes,quality_score,active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(organization_id,person_type,person_id,sample_index) DO UPDATE SET profile_id=excluded.profile_id,algorithm_version=excluded.algorithm_version,embedding_ciphertext=excluded.embedding_ciphertext,embedding_iv=excluded.embedding_iv,embedding_bytes=excluded.embedding_bytes,quality_score=excluded.quality_score,active=1,updated_at=CURRENT_TIMESTAMP`).bind(createId("abs"),d.organization_id,profileId,job.person_type,job.person_id,x.index,v.algorithmVersion,x.secured.ciphertext,x.secured.iv,x.secured.bytes,v.qualityScore)),
    db.prepare("INSERT INTO att_biometric_enrollments(id,organization_id,profile_id,provider_enrollment_ref,algorithm_version,pose_count,quality_score,liveness_score,status,enrolled_by) VALUES (?,?,?,?,?,?,?,?,'completed',?)").bind(enrollmentId,d.organization_id,profileId,`device:${d.id}`,v.algorithmVersion,v.poseCount,v.qualityScore,v.livenessScore,job.requested_by),
    db.prepare("UPDATE att_biometric_enrollment_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP,result_profile_id=?,result_quality_score=?,result_liveness_score=?,failure_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(profileId,v.qualityScore,v.livenessScore,id),
    db.prepare("INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json) VALUES (?,?,'device',?,'biometric.enrolled','biometric_profile',?,?)").bind(createId("ata"),d.organization_id,d.id,profileId,JSON.stringify({personType:job.person_type,personId:job.person_id,algorithmVersion:v.algorithmVersion,qualityScore:v.qualityScore,livenessScore:v.livenessScore,sampleCount:samples.length,timings:v.timings||{}}))
  ]);
  return c.json({data:{jobId:id,profileId,status:"completed",qualityScore:v.qualityScore,livenessScore:v.livenessScore}},201);
});

attendanceDeviceRoutes.post("/face/enrollment-jobs/:id/fail",async c=>{
  const d=await authenticate(c),id=c.req.param("id"),payload=await c.req.json().catch(()=>({})) as any,reason=String(payload.reason||"Enrollment failed").slice(0,500);
  await c.env.FINANCE_DB.prepare("UPDATE att_biometric_enrollment_jobs SET status='failed',failure_reason=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND device_id=? AND status IN ('pending','claimed')").bind(reason,id,d.organization_id,d.id).run();
  return c.json({data:{id,status:"failed",reason}});
});

const event=z.object({
  clientEventId:z.string().min(1).max(150),
  personType:z.enum(["student","staff"]),
  personId:z.string(),
  direction:z.enum(["IN","OUT"]),
  method:z.enum(S.methods),
  verificationMode:z.enum(["STANDARD","TEST","SUPERVISED","UNVERIFIED"]).default("STANDARD"),
  confidence:z.number().min(0).max(1).optional(),
  matchMargin:z.number().min(0).max(2).optional(),
  livenessScore:z.number().min(0).max(1).optional(),
  capturedAt:z.string().datetime(),
  metadata:z.record(z.string(),z.unknown()).optional()
});

attendanceDeviceRoutes.post("/sync",async c=>{
  const d=await authenticate(c);
  const parsed=z.object({clientBatchId:z.string().min(1).max(150),events:z.array(event).min(1).max(500)}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid signed sync batch",parsed.error.flatten());
  const v=parsed.data;
  const old=await c.env.FINANCE_DB.prepare("SELECT * FROM att_device_sync_batches WHERE organization_id=? AND device_id=? AND client_batch_id=?").bind(d.organization_id,d.id,v.clientBatchId).first();
  if(old)return c.json({data:{...S.camel(old),idempotent:true,results:[]}});

  const batchId=createId("asb");
  await c.env.FINANCE_DB.prepare("INSERT INTO att_device_sync_batches(id,organization_id,device_id,client_batch_id,event_count) VALUES (?,?,?,?,?)").bind(batchId,d.organization_id,d.id,v.clientBatchId,v.events.length).run();

  let accepted=0,duplicates=0,rejected=0;
  const results:Array<{clientEventId:string;status:"accepted"|"duplicate"|"rejected";message?:string;eventId?:string}>=[];
  const faceSettings:any=await c.env.FINANCE_DB.prepare("SELECT match_threshold,ambiguity_margin,liveness_threshold FROM att_biometric_settings WHERE organization_id=?").bind(d.organization_id).first();
  const faceMatch=Number(faceSettings?.match_threshold??.78),faceMargin=Number(faceSettings?.ambiguity_margin??.05),faceLive=Number(faceSettings?.liveness_threshold??.70);
  for(const x of v.events){
    try{
      if(d.population!=="mixed"&&d.population!==`${x.personType}s`)throw new Error("Population not allowed on this kiosk");
      if(d.direction!=="BOTH"&&d.direction!==x.direction)throw new Error("Direction not allowed on this kiosk");
      const test=x.verificationMode==="TEST";
      if(test&&!await c.env.FINANCE_DB.prepare("SELECT 1 FROM att_test_mode_grants WHERE organization_id=? AND device_id=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP LIMIT 1").bind(d.organization_id,d.id).first())throw new Error("Face test mode grant is unavailable or expired");
      if(x.method==="FACE"&&!test){
        if(x.verificationMode!=="STANDARD")throw new Error("Official face events require STANDARD verification mode");
        if(x.confidence==null||x.confidence<faceMatch)throw new Error(`Face confidence is below the configured threshold (${faceMatch})`);
        if(x.livenessScore==null||x.livenessScore<faceLive)throw new Error(`Face liveness is below the configured threshold (${faceLive})`);
        if(x.matchMargin==null||x.matchMargin<faceMargin)throw new Error(`Face identity margin is below the configured ambiguity threshold (${faceMargin})`);
      }
      const r=await S.recordEvent(c.env.FINANCE_DB,d.organization_id,null,{...x,faceMatchThreshold:faceMatch,faceAmbiguityMargin:faceMargin,faceLivenessThreshold:faceLive,deviceId:d.id,syncBatchId:batchId,syncedAt:new Date().toISOString(),official:!test});
      if(r.duplicate){duplicates++;results.push({clientEventId:x.clientEventId,status:"duplicate",eventId:r.eventId});}
      else if(r.rejected){rejected++;results.push({clientEventId:x.clientEventId,status:"rejected",message:"Attendance verification was rejected",eventId:r.eventId});}
      else{accepted++;results.push({clientEventId:x.clientEventId,status:"accepted",eventId:r.eventId});}
    }catch(error){
      rejected++;
      results.push({clientEventId:x.clientEventId,status:"rejected",message:error instanceof Error?error.message:String(error)});
    }
  }
  const status=rejected===v.events.length?"rejected":rejected?"partial":"processed";
  await c.env.FINANCE_DB.prepare("UPDATE att_device_sync_batches SET accepted_count=?,duplicate_count=?,rejected_count=?,status=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(accepted,duplicates,rejected,status,batchId).run();
  await c.env.FINANCE_DB.prepare("UPDATE att_devices SET last_sync_at=CURRENT_TIMESTAMP WHERE id=?").bind(d.id).run();
  await c.env.FINANCE_DB.prepare("INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json) VALUES (?,?,'device',?,'offline_sync.processed','sync_batch',?,?)").bind(createId("ata"),d.organization_id,d.id,batchId,JSON.stringify({accepted,duplicates,rejected})).run();
  return c.json({data:{id:batchId,eventCount:v.events.length,accepted,duplicates,rejected,status,results}},202);
});
