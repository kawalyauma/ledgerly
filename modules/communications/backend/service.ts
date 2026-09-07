import type { Env, CommunicationJob } from "../../../src/types";
import { createId } from "../../../src/lib/ids";
import { AppError } from "../../../src/lib/errors";

export const GENERAL_WHATSAPP_TEMPLATE = "general_app_update";
export const GENERAL_WHATSAPP_LANGUAGE = "en_US";

export type Channel = "sms" | "whatsapp";
export type AudienceSpec = {
  kind: string;
  academicYearId?: string | null;
  termId?: string | null;
  classId?: string | null;
  streamId?: string | null;
  campusId?: string | null;
  departmentId?: string | null;
  examId?: string | null;
  taskId?: string | null;
  incidentId?: string | null;
  attendanceDate?: string | null;
  attendanceStatus?: string | null;
  studentIds?: string[];
  staffIds?: string[];
  userIds?: string[];
  contactIds?: string[];
  recipientMode?: "primary_guardian"|"all_guardians"|"student_direct"|"guardians_and_student";
  minimumBalanceMinor?: number;
  teacherOnly?: boolean;
};

type RecipientCandidate = {
  recipientType: string;
  recipientId: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  name: string;
  phone: string | null;
  data: Record<string, unknown>;
};

const BUILTINS = [
  {key:"fee_balance_reminder",name:"Fee balance reminder",module:"school-fees",category:"finance",audience:"fee_balances",subject:"School fees reminder",message:"Our records show an outstanding school fees balance of {{balance}} for {{student_name}}. Please arrange payment or contact the school finance office if you need assistance.",defaults:{recipientMode:"all_guardians",minimumBalanceMinor:1}},
  {key:"fee_due_reminder",name:"Fee due-date reminder",module:"school-fees",category:"finance",audience:"fee_balances",subject:"Fees payment due",message:"A school fees balance of {{balance}} for {{student_name}} remains outstanding. Kindly make payment as soon as possible.",defaults:{recipientMode:"all_guardians",minimumBalanceMinor:1}},
  {key:"results_published",name:"Published examination results",module:"exams",category:"academic",audience:"published_results",subject:"Examination results published",message:"Results for {{student_name}} in {{exam_name}} have been published. Aggregate: {{aggregate}}. Division: {{division}}. Please review the official report card for full details.",defaults:{recipientMode:"all_guardians"}},
  {key:"student_announcement",name:"Student / parent announcement",module:"school-management",category:"general",audience:"students",subject:"Student update",message:"This is an important update concerning {{student_name}}: {{custom_message}}",defaults:{recipientMode:"all_guardians"}},
  {key:"attendance_absence",name:"Student absence notice",module:"attendance",category:"attendance",audience:"attendance",subject:"Attendance notice",message:"{{student_name}} was marked {{attendance_status}} on {{attendance_date}}. {{attendance_reason}}",defaults:{attendanceStatus:"absent",recipientMode:"all_guardians"}},
  {key:"attendance_late",name:"Student late-arrival notice",module:"attendance",category:"attendance",audience:"attendance",subject:"Late arrival notice",message:"{{student_name}} was marked late on {{attendance_date}}. {{attendance_reason}}",defaults:{attendanceStatus:"late",recipientMode:"all_guardians"}},
  {key:"discipline_update",name:"Discipline / behaviour update",module:"discipline",category:"welfare",audience:"discipline",subject:"Student behaviour update",message:"A {{severity}} behaviour/discipline update ({{incident_number}}) has been recorded for {{student_name}}. Please contact the school if you need further details.",defaults:{recipientMode:"all_guardians"}},
  {key:"teacher_announcement",name:"Teacher announcement",module:"school-management",category:"staff",audience:"staff",subject:"Teacher update",message:"{{custom_message}}",defaults:{teacherOnly:true}},
  {key:"staff_announcement",name:"Staff announcement",module:"school-management",category:"staff",audience:"staff",subject:"Staff update",message:"{{custom_message}}",defaults:{teacherOnly:false}},
  {key:"staff_meeting_reminder",name:"Staff meeting reminder",module:"school-management",category:"staff",audience:"staff",subject:"Meeting reminder",message:"Reminder: {{custom_message}}",defaults:{teacherOnly:false}},
  {key:"task_assignment",name:"Task assignment/update",module:"tasks-work",category:"work",audience:"work_users",subject:"Task update",message:"{{custom_message}}",defaults:{}},
  {key:"task_due_reminder",name:"Task due reminder",module:"tasks-work",category:"work",audience:"work_users",subject:"Task reminder",message:"{{custom_message}}",defaults:{}},
  {key:"project_update",name:"Project update",module:"tasks-work",category:"work",audience:"organization_users",subject:"Project update",message:"{{custom_message}}",defaults:{}},
  {key:"organization_announcement",name:"Organization-wide announcement",module:"platform",category:"general",audience:"organization_users",subject:"Organization update",message:"{{custom_message}}",defaults:{}},
  {key:"contact_announcement",name:"Contact / client message",module:"ledgerly",category:"general",audience:"contacts",subject:"Update",message:"{{custom_message}}",defaults:{}},
  {key:"emergency_notice",name:"Emergency / urgent notice",module:"platform",category:"urgent",audience:"students",subject:"Urgent notice",message:"{{custom_message}}",defaults:{recipientMode:"all_guardians"}},
] as const;

export async function ensureBuiltinMessageTypes(db:D1Database, organizationId:string, actorId?:string|null) {
  const statements=BUILTINS.map(x=>db.prepare(`INSERT INTO communication_message_types
    (id,organization_id,type_key,name,module_key,category,audience_kind,subject_template,message_template,audience_defaults_json,system_type,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(organization_id,type_key) DO NOTHING`)
    .bind(createId("cmt"),organizationId,x.key,x.name,x.module,x.category,x.audience,x.subject,x.message,JSON.stringify(x.defaults),actorId||null));
  if(statements.length) await db.batch(statements);
}

function cleanPhone(raw:unknown):string|null {
  let p=String(raw||"").trim().replace(/[\s()\-]/g,"");
  if(!p) return null;
  if(p.startsWith("00")) p=`+${p.slice(2)}`;
  if(/^256\d+$/.test(p)) p=`+${p}`;
  if(/^0\d{9}$/.test(p)) p=`+256${p.slice(1)}`;
  return p.length>=7?p:null;
}

function fullName(...parts:unknown[]) { return parts.map(x=>String(x||"").trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
function list(v:unknown):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==="string"&&x.length>0):[]}
function sqlList(field:string, values:string[], filters:string[], binds:unknown[]){if(values.length){filters.push(`${field} IN (${values.map(()=>"?").join(",")})`);binds.push(...values)}}
function text(v:unknown){return v==null?"":String(v)}
function money(minor:unknown,currency="UGX"){return `${currency} ${(Number(minor||0)/100).toLocaleString("en-UG",{minimumFractionDigits:0,maximumFractionDigits:2})}`}

export function renderTemplate(template:string,data:Record<string,unknown>){
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g,(_,key)=>text(data[key]));
}
export function renderSms(name:string,sender:string,subject:string,message:string){return `Hello ${name},\n${sender} — ${subject}:\n${message}`.trim()}

async function organizationMeta(db:D1Database,organizationId:string){return db.prepare("SELECT name,base_currency AS currency FROM organizations WHERE id=?").bind(organizationId).first<{name:string;currency:string}>()}

function studentFilters(a:AudienceSpec, alias="s"){
  const f=[`${alias}.organization_id=?`,`${alias}.deleted_at IS NULL`,`${alias}.status='active'`],b:unknown[]=[];
  b.push(null); // caller replaces first organization id
  if(a.academicYearId){f.push(`${alias}.current_academic_year_id=?`);b.push(a.academicYearId)}
  if(a.classId){f.push(`${alias}.current_class_id=?`);b.push(a.classId)}
  if(a.streamId){f.push(`${alias}.current_stream_id=?`);b.push(a.streamId)}
  if(a.campusId){f.push(`${alias}.campus_id=?`);b.push(a.campusId)}
  sqlList(`${alias}.id`,list(a.studentIds),f,b);
  return {filters:f,binds:b};
}

async function studentGuardianAudience(db:D1Database,orgId:string,a:AudienceSpec,purpose:"academic"|"financial"|"general"="general"){
  const {filters,binds}=studentFilters(a);binds[0]=orgId;
  const mode=a.recipientMode||"all_guardians";
  const rel=[...filters];
  if(mode==="primary_guardian")rel.push("sg.is_primary=1");
  if(purpose==="academic")rel.push("sg.receives_academic_updates=1");
  if(purpose==="financial")rel.push("sg.receives_financial_updates=1");
  const result:RecipientCandidate[]=[];
  if(mode!=="student_direct"){
    const rows=await db.prepare(`SELECT s.id AS student_id,s.first_name,s.middle_name,s.last_name,s.admission_number,s.student_number,
      cl.name AS class_name,st.name AS stream_name,g.id AS guardian_id,g.first_name AS guardian_first,g.middle_name AS guardian_middle,g.last_name AS guardian_last,
      COALESCE(g.phone_primary,cp.phone) AS phone,sg.relationship,sg.is_primary
      FROM school_students s JOIN school_student_guardians sg ON sg.organization_id=s.organization_id AND sg.student_id=s.id
      JOIN school_guardians g ON g.id=sg.guardian_id AND g.organization_id=sg.organization_id AND g.active=1
      LEFT JOIN contact_people cp ON cp.organization_id=g.organization_id AND cp.contact_id=g.contact_id AND cp.is_primary=1
      LEFT JOIN school_classes cl ON cl.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id
      WHERE ${rel.join(" AND ")} ORDER BY s.last_name,s.first_name,sg.is_primary DESC,g.last_name,g.first_name`).bind(...binds).all<any>();
    for(const r of rows.results) result.push({recipientType:"guardian",recipientId:r.guardian_id,relatedEntityType:"student",relatedEntityId:r.student_id,name:fullName(r.guardian_first,r.guardian_middle,r.guardian_last)||"Parent/Guardian",phone:cleanPhone(r.phone),data:{student_id:r.student_id,student_name:fullName(r.first_name,r.middle_name,r.last_name),admission_number:r.admission_number,student_number:r.student_number,class_name:r.class_name||"",stream_name:r.stream_name||"",relationship:r.relationship||"Guardian"}});
  }
  if(mode==="student_direct"||mode==="guardians_and_student"){
    const rows=await db.prepare(`SELECT s.id,s.first_name,s.middle_name,s.last_name,s.phone,s.admission_number,s.student_number,cl.name AS class_name,st.name AS stream_name FROM school_students s LEFT JOIN school_classes cl ON cl.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id WHERE ${filters.join(" AND ")} ORDER BY s.last_name,s.first_name`).bind(...binds).all<any>();
    for(const r of rows.results) result.push({recipientType:"student",recipientId:r.id,relatedEntityType:"student",relatedEntityId:r.id,name:fullName(r.first_name,r.middle_name,r.last_name),phone:cleanPhone(r.phone),data:{student_id:r.id,student_name:fullName(r.first_name,r.middle_name,r.last_name),admission_number:r.admission_number,student_number:r.student_number,class_name:r.class_name||"",stream_name:r.stream_name||""}});
  }
  return result;
}

async function feeAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const meta=await organizationMeta(db,orgId);const min=Math.max(1,Number(a.minimumBalanceMinor||1));
  const f=["s.organization_id=?","s.deleted_at IS NULL","s.status='active'","c.status<>'cancelled'","(c.document_id IS NULL OR d.status<>'void')"],b:unknown[]=[orgId];
  if(a.academicYearId){f.push("c.academic_year_id=?");b.push(a.academicYearId)}if(a.termId){f.push("c.term_id=?");b.push(a.termId)}if(a.classId){f.push("s.current_class_id=?");b.push(a.classId)}if(a.streamId){f.push("s.current_stream_id=?");b.push(a.streamId)}if(a.campusId){f.push("s.campus_id=?");b.push(a.campusId)}sqlList("s.id",list(a.studentIds),f,b);
  const rows=await db.prepare(`WITH balances AS (
    SELECT s.id AS student_id,s.first_name,s.middle_name,s.last_name,s.admission_number,s.student_number,cl.name AS class_name,st.name AS stream_name,
      COALESCE(SUM(c.total_minor-(SELECT COALESCE(SUM(pa.amount_minor),0) FROM payment_allocations pa WHERE pa.organization_id=c.organization_id AND pa.document_id=c.document_id AND pa.reversed_at IS NULL)-c.credited_minor-c.written_off_minor),0) AS balance_minor,
      MIN(CASE WHEN c.total_minor>(SELECT COALESCE(SUM(pa.amount_minor),0) FROM payment_allocations pa WHERE pa.organization_id=c.organization_id AND pa.document_id=c.document_id AND pa.reversed_at IS NULL)+c.credited_minor+c.written_off_minor THEN c.due_date END) AS oldest_due_date
    FROM school_students s JOIN school_student_fee_charges c ON c.student_id=s.id AND c.organization_id=s.organization_id LEFT JOIN documents d ON d.id=c.document_id LEFT JOIN school_classes cl ON cl.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id
    WHERE ${f.join(" AND ")} GROUP BY s.id HAVING balance_minor>=?
  ) SELECT b.*,g.id AS guardian_id,g.first_name AS guardian_first,g.middle_name AS guardian_middle,g.last_name AS guardian_last,COALESCE(g.phone_primary,cp.phone) AS phone,sg.relationship,sg.is_primary
    FROM balances b JOIN school_student_guardians sg ON sg.organization_id=? AND sg.student_id=b.student_id JOIN school_guardians g ON g.id=sg.guardian_id AND g.organization_id=sg.organization_id AND g.active=1
    LEFT JOIN contact_people cp ON cp.organization_id=g.organization_id AND cp.contact_id=g.contact_id AND cp.is_primary=1
    WHERE sg.receives_financial_updates=1 AND (sg.is_financially_responsible=1 OR sg.is_primary=1)
    ORDER BY b.balance_minor DESC,sg.is_primary DESC`).bind(...b,min,orgId).all<any>();
  return rows.results.map(r=>({recipientType:"guardian",recipientId:r.guardian_id,relatedEntityType:"student",relatedEntityId:r.student_id,name:fullName(r.guardian_first,r.guardian_middle,r.guardian_last)||"Parent/Guardian",phone:cleanPhone(r.phone),data:{student_id:r.student_id,student_name:fullName(r.first_name,r.middle_name,r.last_name),admission_number:r.admission_number,student_number:r.student_number,class_name:r.class_name||"",stream_name:r.stream_name||"",balance_minor:Number(r.balance_minor||0),balance:money(r.balance_minor,meta?.currency||"UGX"),due_date:r.oldest_due_date||""}} satisfies RecipientCandidate));
}

async function resultsAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const f=["rc.organization_id=?","rc.is_published=1"],b:unknown[]=[orgId];if(a.examId){f.push("rc.exam_id=?");b.push(a.examId)}if(a.classId){f.push("rc.class_id=?");b.push(a.classId)}if(a.streamId){f.push("rc.stream_id=?");b.push(a.streamId)}sqlList("rc.student_id",list(a.studentIds),f,b);
  const rows=await db.prepare(`SELECT rc.student_id,rc.aggregate,rc.division,rc.position_in_class,e.name AS exam_name,s.first_name,s.middle_name,s.last_name,s.admission_number,s.student_number,cl.name AS class_name,st.name AS stream_name,g.id AS guardian_id,g.first_name AS guardian_first,g.middle_name AS guardian_middle,g.last_name AS guardian_last,COALESCE(g.phone_primary,cp.phone) AS phone,sg.relationship
    FROM exm_report_cards rc JOIN exm_exams e ON e.id=rc.exam_id JOIN school_students s ON s.id=rc.student_id JOIN school_student_guardians sg ON sg.organization_id=rc.organization_id AND sg.student_id=rc.student_id AND sg.receives_academic_updates=1 JOIN school_guardians g ON g.id=sg.guardian_id AND g.active=1 LEFT JOIN contact_people cp ON cp.organization_id=g.organization_id AND cp.contact_id=g.contact_id AND cp.is_primary=1 LEFT JOIN school_classes cl ON cl.id=rc.class_id LEFT JOIN school_streams st ON st.id=rc.stream_id WHERE ${f.join(" AND ")} ORDER BY s.last_name,s.first_name,sg.is_primary DESC`).bind(...b).all<any>();
  return rows.results.map(r=>({recipientType:"guardian",recipientId:r.guardian_id,relatedEntityType:"student",relatedEntityId:r.student_id,name:fullName(r.guardian_first,r.guardian_middle,r.guardian_last)||"Parent/Guardian",phone:cleanPhone(r.phone),data:{student_id:r.student_id,student_name:fullName(r.first_name,r.middle_name,r.last_name),admission_number:r.admission_number,student_number:r.student_number,class_name:r.class_name||"",stream_name:r.stream_name||"",exam_name:r.exam_name||"Examination",aggregate:r.aggregate??"—",division:r.division??"—",position:r.position_in_class??"—"}} satisfies RecipientCandidate));
}

async function staffAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const f=["sp.organization_id=?","sp.deleted_at IS NULL","sp.employment_status='active'"],b:unknown[]=[orgId];if(a.teacherOnly)f.push("sp.is_teacher=1");if(a.campusId){f.push("sp.campus_id=?");b.push(a.campusId)}if(a.departmentId){f.push("sp.department_id=?");b.push(a.departmentId)}sqlList("sp.id",list(a.staffIds),f,b);
  const rows=await db.prepare(`SELECT sp.id,sp.user_id,sp.first_name,sp.middle_name,sp.last_name,sp.preferred_name,sp.phone,sp.staff_number,sp.is_teacher,d.name AS department_name,pos.name AS position_name FROM school_staff_profiles sp LEFT JOIN school_departments d ON d.id=sp.department_id LEFT JOIN school_staff_positions pos ON pos.id=sp.position_id WHERE ${f.join(" AND ")} ORDER BY sp.last_name,sp.first_name`).bind(...b).all<any>();
  return rows.results.map(r=>({recipientType:"staff",recipientId:r.id,relatedEntityType:r.user_id?"user":null,relatedEntityId:r.user_id||null,name:r.preferred_name||fullName(r.first_name,r.middle_name,r.last_name),phone:cleanPhone(r.phone),data:{staff_id:r.id,staff_number:r.staff_number||"",department_name:r.department_name||"",position_name:r.position_name||"",is_teacher:Boolean(r.is_teacher)}} satisfies RecipientCandidate));
}

async function orgUsersAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const f=["m.organization_id=?","u.status='active'"],b:unknown[]=[orgId];sqlList("u.id",list(a.userIds),f,b);
  const rows=await db.prepare(`SELECT u.id,u.display_name,COALESCE(sp.phone,sfp.phone) AS phone,m.role,sfp.staff_number FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN school_user_profiles sp ON sp.organization_id=m.organization_id AND sp.user_id=u.id LEFT JOIN school_staff_profiles sfp ON sfp.organization_id=m.organization_id AND sfp.user_id=u.id AND sfp.deleted_at IS NULL WHERE ${f.join(" AND ")} ORDER BY u.display_name`).bind(...b).all<any>();
  return rows.results.map(r=>({recipientType:"user",recipientId:r.id,relatedEntityType:"user",relatedEntityId:r.id,name:r.display_name||"User",phone:cleanPhone(r.phone),data:{user_id:r.id,role:r.role||"",staff_number:r.staff_number||""}} satisfies RecipientCandidate));
}

async function contactsAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const f=["c.organization_id=?","c.active=1","c.archived_at IS NULL"],b:unknown[]=[orgId];sqlList("c.id",list(a.contactIds),f,b);
  const rows=await db.prepare(`SELECT c.id,c.name,c.type,c.code,COALESCE(cp.name,c.name) AS recipient_name,cp.phone FROM contacts c LEFT JOIN contact_people cp ON cp.organization_id=c.organization_id AND cp.contact_id=c.id AND cp.is_primary=1 WHERE ${f.join(" AND ")} ORDER BY c.name`).bind(...b).all<any>();
  return rows.results.map(r=>({recipientType:"contact",recipientId:r.id,relatedEntityType:"contact",relatedEntityId:r.id,name:r.recipient_name||r.name,phone:cleanPhone(r.phone),data:{contact_id:r.id,contact_name:r.name,contact_type:r.type||"",contact_code:r.code||""}} satisfies RecipientCandidate));
}

async function attendanceAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const f=["ses.organization_id=?","ses.status IN ('finalized','locked')","r.person_type='student'","r.official=1","r.status=?"],b:unknown[]=[orgId,a.attendanceStatus||"absent"];if(a.attendanceDate){f.push("ses.attendance_date=?");b.push(a.attendanceDate)}if(a.classId){f.push("ses.class_id=?");b.push(a.classId)}if(a.streamId){f.push("ses.stream_id=?");b.push(a.streamId)}sqlList("r.person_id",list(a.studentIds),f,b);
  const rows=await db.prepare(`SELECT r.person_id AS student_id,r.status AS attendance_status,r.reason,r.minutes_late,ses.attendance_date,s.first_name,s.middle_name,s.last_name,cl.name AS class_name,st.name AS stream_name,g.id AS guardian_id,g.first_name AS guardian_first,g.middle_name AS guardian_middle,g.last_name AS guardian_last,COALESCE(g.phone_primary,cp.phone) AS phone FROM att_records r JOIN att_sessions ses ON ses.id=r.session_id JOIN school_students s ON s.id=r.person_id JOIN school_student_guardians sg ON sg.organization_id=r.organization_id AND sg.student_id=r.person_id AND sg.receives_academic_updates=1 JOIN school_guardians g ON g.id=sg.guardian_id AND g.active=1 LEFT JOIN contact_people cp ON cp.organization_id=g.organization_id AND cp.contact_id=g.contact_id AND cp.is_primary=1 LEFT JOIN school_classes cl ON cl.id=ses.class_id LEFT JOIN school_streams st ON st.id=ses.stream_id WHERE ${f.join(" AND ")} ORDER BY s.last_name,s.first_name,sg.is_primary DESC`).bind(...b).all<any>();
  return rows.results.map(r=>({recipientType:"guardian",recipientId:r.guardian_id,relatedEntityType:"student",relatedEntityId:r.student_id,name:fullName(r.guardian_first,r.guardian_middle,r.guardian_last)||"Parent/Guardian",phone:cleanPhone(r.phone),data:{student_id:r.student_id,student_name:fullName(r.first_name,r.middle_name,r.last_name),class_name:r.class_name||"",stream_name:r.stream_name||"",attendance_status:r.attendance_status,attendance_date:r.attendance_date,attendance_reason:r.reason||"",minutes_late:Number(r.minutes_late||0)}} satisfies RecipientCandidate));
}

async function disciplineAudience(db:D1Database,orgId:string,a:AudienceSpec){
  const f=["i.organization_id=?"],b:unknown[]=[orgId];if(a.incidentId){f.push("i.id=?");b.push(a.incidentId)}sqlList("i.student_id",list(a.studentIds),f,b);
  const rows=await db.prepare(`SELECT i.id,i.incident_number,i.student_id,i.title,i.severity,i.status,s.first_name,s.middle_name,s.last_name,g.id AS guardian_id,g.first_name AS guardian_first,g.middle_name AS guardian_middle,g.last_name AS guardian_last,COALESCE(g.phone_primary,cp.phone) AS phone FROM school_discipline_incidents i JOIN school_students s ON s.id=i.student_id JOIN school_student_guardians sg ON sg.organization_id=i.organization_id AND sg.student_id=i.student_id AND sg.receives_academic_updates=1 JOIN school_guardians g ON g.id=sg.guardian_id AND g.active=1 LEFT JOIN contact_people cp ON cp.organization_id=g.organization_id AND cp.contact_id=g.contact_id AND cp.is_primary=1 WHERE ${f.join(" AND ")} ORDER BY i.incident_at DESC,sg.is_primary DESC`).bind(...b).all<any>();
  return rows.results.map(r=>({recipientType:"guardian",recipientId:r.guardian_id,relatedEntityType:"discipline_incident",relatedEntityId:r.id,name:fullName(r.guardian_first,r.guardian_middle,r.guardian_last)||"Parent/Guardian",phone:cleanPhone(r.phone),data:{student_id:r.student_id,student_name:fullName(r.first_name,r.middle_name,r.last_name),incident_id:r.id,incident_number:r.incident_number,severity:r.severity,status:r.status}} satisfies RecipientCandidate));
}

async function workUsersAudience(db:D1Database,orgId:string,a:AudienceSpec){
  if(!a.taskId)return orgUsersAudience(db,orgId,a);
  const rows=await db.prepare(`SELECT DISTINCT u.id,u.display_name,COALESCE(sup.phone,sfp.phone) AS phone,t.task_number,t.title AS task_title,t.status AS task_status,t.due_at FROM work_tasks t JOIN (SELECT task_id,user_id FROM work_task_assignees UNION SELECT task_id,user_id FROM work_task_followers) x ON x.task_id=t.id JOIN users u ON u.id=x.user_id LEFT JOIN school_user_profiles sup ON sup.organization_id=t.organization_id AND sup.user_id=u.id LEFT JOIN school_staff_profiles sfp ON sfp.organization_id=t.organization_id AND sfp.user_id=u.id AND sfp.deleted_at IS NULL WHERE t.organization_id=? AND t.id=? AND t.archived_at IS NULL ORDER BY u.display_name`).bind(orgId,a.taskId).all<any>();
  return rows.results.map(r=>({recipientType:"user",recipientId:r.id,relatedEntityType:"work_task",relatedEntityId:a.taskId||null,name:r.display_name||"User",phone:cleanPhone(r.phone),data:{task_number:r.task_number,task_title:r.task_title,task_status:r.task_status,due_at:r.due_at||""}} satisfies RecipientCandidate));
}

export async function resolveAudience(db:D1Database,orgId:string,a:AudienceSpec):Promise<RecipientCandidate[]> {
  switch(a.kind){
    case "fee_balances":return feeAudience(db,orgId,a);
    case "published_results":return resultsAudience(db,orgId,a);
    case "students":return studentGuardianAudience(db,orgId,a,"academic");
    case "attendance":return attendanceAudience(db,orgId,a);
    case "discipline":return disciplineAudience(db,orgId,a);
    case "staff":return staffAudience(db,orgId,a);
    case "organization_users":return orgUsersAudience(db,orgId,a);
    case "work_users":return workUsersAudience(db,orgId,a);
    case "contacts":return contactsAudience(db,orgId,a);
    default:throw new AppError(422,"INVALID_AUDIENCE","Unsupported communication audience type");
  }
}

async function applyPreferences(db:D1Database,orgId:string,candidates:RecipientCandidate[],channels:Channel[]){
  if(!candidates.length)return candidates.map(x=>({...x,allowedChannels:channels}));
  const keys=[...new Set(candidates.filter(x=>x.recipientId).map(x=>`${x.recipientType}:${x.recipientId}`))];
  const pref=new Map<string,{sms_enabled:number;whatsapp_enabled:number;do_not_contact:number}>();
  for(let i=0;i<keys.length;i+=100){const chunk=keys.slice(i,i+100);const cond=chunk.map(()=>"(recipient_type=? AND recipient_id=?)").join(" OR "),bind:unknown[]=[orgId];for(const key of chunk){const [t,...rest]=key.split(":");bind.push(t,rest.join(":"))}const rows=await db.prepare(`SELECT recipient_type,recipient_id,sms_enabled,whatsapp_enabled,do_not_contact FROM communication_preferences WHERE organization_id=? AND (${cond})`).bind(...bind).all<any>();for(const r of rows.results)pref.set(`${r.recipient_type}:${r.recipient_id}`,r)}
  return candidates.map(x=>{const p=x.recipientId?pref.get(`${x.recipientType}:${x.recipientId}`):undefined;const allowed=p?.do_not_contact?[]:channels.filter(ch=>ch==="sms"?p?.sms_enabled!==0:p?.whatsapp_enabled!==0);return {...x,allowedChannels:allowed}});
}

export async function previewAudience(db:D1Database,orgId:string,a:AudienceSpec,channels:Channel[]){
  const rows=await applyPreferences(db,orgId,await resolveAudience(db,orgId,a),channels);
  const reachable=rows.filter(x=>x.phone&&x.allowedChannels.length);const missing=rows.filter(x=>!x.phone);const suppressed=rows.filter(x=>x.phone&&!x.allowedChannels.length);
  return {total:rows.length,reachable:reachable.length,missingPhone:missing.length,suppressed:suppressed.length,estimatedDeliveries:reachable.reduce((n,x)=>n+x.allowedChannels.length,0),samples:rows.slice(0,20).map(x=>({recipientType:x.recipientType,recipientId:x.recipientId,relatedEntityType:x.relatedEntityType,relatedEntityId:x.relatedEntityId,name:x.name,phone:x.phone,channels:x.allowedChannels,data:x.data}))};
}

export async function dispatchCampaign(env:Env,campaignId:string){
  const db=env.FINANCE_DB;const campaign=await db.prepare(`SELECT * FROM communication_campaigns WHERE id=?`).bind(campaignId).first<any>();if(!campaign)throw new AppError(404,"CAMPAIGN_NOT_FOUND","Communication campaign not found");if(["sending","completed","partial"].includes(campaign.status))return {id:campaignId,status:campaign.status};if(campaign.status==="cancelled")throw new AppError(409,"CAMPAIGN_CANCELLED","Cancelled campaigns cannot be sent");
  const channels=JSON.parse(campaign.channels_json||"[]") as Channel[];const audience=JSON.parse(campaign.audience_json||"{}") as AudienceSpec;
  if(channels.includes("sms")&&(!env.EGOSMS_USERNAME||!env.EGOSMS_PASSWORD||!env.EGOSMS_SENDER_ID))throw new AppError(422,"SMS_NOT_CONFIGURED","EgoSMS credentials are not configured");
  if(channels.includes("whatsapp")&&(!env.WHATSAPP_SUPPORT_APP_KEY||!env.WHATSAPP_SUPPORT_HUB_URL))throw new AppError(422,"WHATSAPP_NOT_CONFIGURED","WhatsApp Hub credentials are not configured");
  const existing=await db.prepare("SELECT COUNT(*) AS count FROM communication_recipients WHERE campaign_id=?").bind(campaignId).first<{count:number}>();if(Number(existing?.count||0)>0)throw new AppError(409,"CAMPAIGN_ALREADY_SNAPSHOTTED","This campaign already has a recipient snapshot");
  const candidates=await applyPreferences(db,campaign.organization_id,await resolveAudience(db,campaign.organization_id,audience),channels);const org=await organizationMeta(db,campaign.organization_id);const recipientStatements:D1PreparedStatement[]=[],deliveryStatements:D1PreparedStatement[]=[],jobs:CommunicationJob[]=[];let skipped=0,deliveryCount=0;
  for(const c of candidates){const rid=createId("cmr"),noPhone=!c.phone,noChannels=!c.allowedChannels.length,status=noPhone||noChannels?"skipped":"queued",reason=noPhone?"No usable phone number":noChannels?"Recipient communication preferences suppress selected channels":null;recipientStatements.push(db.prepare(`INSERT INTO communication_recipients (id,organization_id,campaign_id,recipient_type,recipient_id,related_entity_type,related_entity_id,recipient_name,phone,data_json,status,skip_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid,campaign.organization_id,campaignId,c.recipientType,c.recipientId||null,c.relatedEntityType||null,c.relatedEntityId||null,c.name,c.phone||null,JSON.stringify(c.data),status,reason));if(reason){skipped++;continue}const baseData={...c.data,recipient_name:c.name,organization_name:campaign.sender_name,currency:org?.currency||"UGX"};const subject=renderTemplate(campaign.subject_template,baseData);const message=renderTemplate(campaign.message_template,baseData);for(const channel of c.allowedChannels){const did=createId("cmd"),provider=channel==="sms"?"egosms":"ulib_whatsapp_hub",templateVariables=channel==="whatsapp"?[c.name,campaign.sender_name,subject,message]:[];deliveryStatements.push(db.prepare(`INSERT INTO communication_deliveries (id,organization_id,campaign_id,recipient_snapshot_id,channel,recipient_phone,provider,template_name,template_language,template_variables_json,rendered_subject,rendered_message,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'queued')`).bind(did,campaign.organization_id,campaignId,rid,channel,c.phone,provider,channel==="whatsapp"?GENERAL_WHATSAPP_TEMPLATE:null,channel==="whatsapp"?GENERAL_WHATSAPP_LANGUAGE:null,JSON.stringify(templateVariables),subject,message));jobs.push({kind:"communication",deliveryId:did,organizationId:campaign.organization_id,campaignId,recipientSnapshotId:rid,channel,recipient:c.phone!,senderName:campaign.sender_name,subject,message,templateName:channel==="whatsapp"?GENERAL_WHATSAPP_TEMPLATE:undefined,templateLanguage:channel==="whatsapp"?GENERAL_WHATSAPP_LANGUAGE:undefined,variables:channel==="whatsapp"?templateVariables:undefined});deliveryCount++}}
  for(let i=0;i<recipientStatements.length;i+=50)await db.batch(recipientStatements.slice(i,i+50));for(let i=0;i<deliveryStatements.length;i+=50)await db.batch(deliveryStatements.slice(i,i+50));await db.prepare(`UPDATE communication_campaigns SET status='sending',started_at=CURRENT_TIMESTAMP,recipient_count=?,skipped_count=?,delivery_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(candidates.length,skipped,deliveryCount,campaignId).run();
  for(let i=0;i<jobs.length;i+=100)await env.COMMUNICATION_QUEUE.sendBatch(jobs.slice(i,i+100).map(body=>({body,contentType:"json" as const})));
  if(!jobs.length){await db.prepare(`UPDATE communication_campaigns SET status='failed',completed_at=CURRENT_TIMESTAMP,failed_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(campaignId).run();}
  return {id:campaignId,status:jobs.length?"sending":"failed",recipientCount:candidates.length,skippedCount:skipped,deliveryCount};
}

async function refreshCampaignStatus(db:D1Database,campaignId:string){
  const x=await db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,SUM(CASE WHEN status IN ('queued','sending') THEN 1 ELSE 0 END) AS pending FROM communication_deliveries WHERE campaign_id=?`).bind(campaignId).first<any>();
  const total=Number(x?.total||0),sent=Number(x?.sent||0),failed=Number(x?.failed||0),pending=Number(x?.pending||0);
  if(pending===0&&total>0){const status=failed===0?"completed":sent>0?"partial":"failed";await db.prepare("UPDATE communication_campaigns SET status=?,sent_count=?,failed_count=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,sent,failed,campaignId).run()}else await db.prepare("UPDATE communication_campaigns SET sent_count=?,failed_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sent,failed,campaignId).run();
  const recipientStats=await db.prepare(`SELECT recipient_snapshot_id AS id,COUNT(*) AS total,SUM(CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,SUM(CASE WHEN status IN ('queued','sending') THEN 1 ELSE 0 END) AS pending FROM communication_deliveries WHERE campaign_id=? GROUP BY recipient_snapshot_id`).bind(campaignId).all<any>();
  const updates=recipientStats.results.map(r=>{const rt=Number(r.total||0),rs=Number(r.sent||0),rf=Number(r.failed||0),rp=Number(r.pending||0),status=rp?"queued":rf===0&&rs===rt?"sent":rs>0?"partial":"failed";return db.prepare("UPDATE communication_recipients SET status=? WHERE id=?").bind(status,r.id)});
  for(let i=0;i<updates.length;i+=50)await db.batch(updates.slice(i,i+50));
}

async function sendSms(env:Env,number:string,message:string){const url=new URL(env.EGOSMS_API_URL||"https://www.egosms.co/api/v1/plain/");url.searchParams.set("username",env.EGOSMS_USERNAME!);url.searchParams.set("password",env.EGOSMS_PASSWORD!);url.searchParams.set("number",number.replace(/^\+/,""));url.searchParams.set("message",message);url.searchParams.set("sender",env.EGOSMS_SENDER_ID!);const r=await fetch(url,{method:"GET"});const t=await r.text();if(!r.ok||/error|failed|invalid/i.test(t))throw new Error(`EgoSMS failed: ${t.slice(0,300)}`);return t.trim()}
async function sendWhatsApp(env:Env,job:CommunicationJob){const r=await fetch(`${env.WHATSAPP_SUPPORT_HUB_URL!.replace(/\/$/,"")}/v1/integrations/templates/send`,{method:"POST",headers:{"X-API-Key":env.WHATSAPP_SUPPORT_APP_KEY!,"Content-Type":"application/json","Idempotency-Key":job.deliveryId},body:JSON.stringify({phoneNumber:job.recipient,templateName:GENERAL_WHATSAPP_TEMPLATE,language:GENERAL_WHATSAPP_LANGUAGE,variables:job.variables||["Recipient",job.senderName,job.subject,job.message]})});const p=await r.json<any>().catch(()=>({}));if(!r.ok||p.success===false)throw new Error(p.error?.message||`WhatsApp Hub failed with HTTP ${r.status}`);return String(p.data?.messageId||p.data?.id||"")}

export async function consumeCommunicationQueue(batch:MessageBatch<CommunicationJob>,env:Env){
  const touched=new Set<string>();for(const m of batch.messages){const j=m.body;touched.add(j.campaignId);try{await env.FINANCE_DB.prepare("UPDATE communication_deliveries SET status='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('sent','delivered')").bind(j.deliveryId).run();let providerId="";if(j.channel==="sms")providerId=await sendSms(env,j.recipient,renderSms("Recipient",j.senderName,j.subject,j.message));else providerId=await sendWhatsApp(env,j);await env.FINANCE_DB.prepare("UPDATE communication_deliveries SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL,failed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(providerId,j.deliveryId).run();m.ack()}catch(e){const error=e instanceof Error?e.message.slice(0,1000):String(e).slice(0,1000);if(m.attempts<4){await env.FINANCE_DB.prepare("UPDATE communication_deliveries SET status='queued',last_error=?,failed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(error,j.deliveryId).run();m.retry({delaySeconds:Math.min(3600,30*2**m.attempts)})}else{await env.FINANCE_DB.prepare("UPDATE communication_deliveries SET status='failed',last_error=?,failed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(error,j.deliveryId).run();m.ack()}}}for(const id of touched)await refreshCampaignStatus(env.FINANCE_DB,id)
}

export async function runScheduledCampaigns(env:Env){const rows=await env.FINANCE_DB.prepare("SELECT id FROM communication_campaigns WHERE status='scheduled' AND scheduled_at<=CURRENT_TIMESTAMP ORDER BY scheduled_at LIMIT 20").all<{id:string}>();for(const r of rows.results){try{await dispatchCampaign(env,r.id)}catch(e){await env.FINANCE_DB.prepare("UPDATE communication_campaigns SET status='failed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(r.id).run();console.error(JSON.stringify({level:"error",module:"communications",campaignId:r.id,message:e instanceof Error?e.message:String(e)}))}}}

export async function retryFailedDeliveries(env:Env,orgId:string,campaignId:string){const rows=await env.FINANCE_DB.prepare(`SELECT d.id,d.recipient_snapshot_id,d.channel,d.recipient_phone,d.rendered_subject,d.rendered_message,d.template_variables_json,c.sender_name FROM communication_deliveries d JOIN communication_campaigns c ON c.id=d.campaign_id WHERE d.organization_id=? AND d.campaign_id=? AND d.status='failed'`).bind(orgId,campaignId).all<any>();const jobs:CommunicationJob[]=rows.results.map(r=>{const saved=JSON.parse(r.template_variables_json||"[]");const variables=Array.isArray(saved)?saved:Object.keys(saved).sort((a,b)=>Number(a)-Number(b)).map(key=>saved[key]);return {kind:"communication",deliveryId:r.id,organizationId:orgId,campaignId,recipientSnapshotId:r.recipient_snapshot_id,channel:r.channel,recipient:r.recipient_phone,senderName:r.sender_name,subject:r.rendered_subject,message:r.rendered_message,templateName:r.channel==="whatsapp"?GENERAL_WHATSAPP_TEMPLATE:undefined,templateLanguage:r.channel==="whatsapp"?GENERAL_WHATSAPP_LANGUAGE:undefined,variables:r.channel==="whatsapp"?variables:undefined}});if(rows.results.length)await env.FINANCE_DB.prepare("UPDATE communication_deliveries SET status='queued',last_error=NULL,failed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND campaign_id=? AND status='failed'").bind(orgId,campaignId).run();for(let i=0;i<jobs.length;i+=100)await env.COMMUNICATION_QUEUE.sendBatch(jobs.slice(i,i+100).map(body=>({body,contentType:"json" as const})));if(jobs.length)await env.FINANCE_DB.prepare("UPDATE communication_campaigns SET status='sending',completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(campaignId,orgId).run();return jobs.length}
