import type { MobileSyncRecord,MobileSyncSnapshotContext } from "../../mobile-sync/backend/contracts";
type R=Record<string,any>;
const ver=(r:R)=>Math.max(1,Number(r.syncVersion??1));
const at=(r:R)=>String(r.updatedAt??r.updated_at??r.entered_at??r.created_at??new Date().toISOString());
const clean=(r:R)=>{const p={...r};delete p.syncVersion;return p};
const rec=(r:R,id:string,payload:unknown):MobileSyncRecord=>({id,version:ver(r),updatedAt:at(r),payload});
async function rows(c:MobileSyncSnapshotContext,sql:string,collection:string,id:(r:R)=>string){const x=await c.db.prepare(sql).bind(c.organizationId).all<R>();return x.results.map(r=>rec(r,id(r),clean(r)));}
export async function snapshotExamSetup(c:MobileSyncSnapshotContext){
 const out:MobileSyncRecord[]=[];
 const specs:[string,string,string][]=[
  ["scale",`SELECT a.*,v.version syncVersion FROM exm_grading_scales a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='setup' AND v.record_id='scale:'||a.id WHERE a.organization_id=? AND a.active=1`,"id"],
  ["band",`SELECT a.*,v.version syncVersion FROM exm_grade_bands a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='setup' AND v.record_id='band:'||a.id WHERE a.organization_id=?`,"id"],
  ["comment",`SELECT a.*,v.version syncVersion FROM exm_comment_rules a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='setup' AND v.record_id='comment:'||a.id WHERE a.organization_id=? AND a.active=1`,"id"],
  ["exam",`SELECT a.*,v.version syncVersion FROM exm_exams a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='setup' AND v.record_id='exam:'||a.id WHERE a.organization_id=? AND a.status<>'archived'`,"id"],
  ["class",`SELECT a.*,v.version syncVersion FROM exm_exam_classes a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='setup' AND v.record_id='class:'||a.id WHERE a.organization_id=?`,"id"],
  ["subject",`SELECT a.*,v.version syncVersion FROM exm_exam_subjects a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='setup' AND v.record_id='subject:'||a.id WHERE a.organization_id=?`,"id"],
 ];
 for(const [kind,sql] of specs){const x=await c.db.prepare(sql).bind(c.organizationId).all<R>();for(const r of x.results)out.push(rec(r,`${kind}:${r.id}`,{entityType:kind,...clean(r)}));}return out;
}
export async function snapshotMarks(c:MobileSyncSnapshotContext){return rows(c,`SELECT a.*,v.version syncVersion FROM exm_marks a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='marks' AND v.record_id=a.exam_id||':'||a.student_id||':'||a.subject_id WHERE a.organization_id=?`,"marks",r=>`${r.exam_id}:${r.student_id}:${r.subject_id}`);}
export async function snapshotReportCards(c:MobileSyncSnapshotContext){return rows(c,`SELECT a.*,v.version syncVersion FROM exm_report_cards a LEFT JOIN mobile_sync_record_versions v ON v.organization_id=a.organization_id AND v.module_key='exams' AND v.collection_key='report-cards' AND v.record_id=a.exam_id||':'||a.student_id WHERE a.organization_id=?`,"report-cards",r=>`${r.exam_id}:${r.student_id}`);}
