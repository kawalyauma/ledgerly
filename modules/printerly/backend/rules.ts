// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

const makeId=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const now=()=>new Date().toISOString();
const arr=(v:any)=>Array.isArray(v)?v.map(String).filter(Boolean):[];
const num=(v:any)=>v===null||v===""||typeof v==="undefined"?null:(Number.isFinite(Number(v))?Number(v):null);
const safeJson=(v:any,fallback:any)=>{try{return v?JSON.parse(String(v)):fallback}catch{return fallback}};
const priorities=new Set(["urgent","high","normal","bulk"]);
const pageSizes=new Set(["A4","A5","Letter","Legal"]);
const colors=new Set(["monochrome","color"]);

function normalizeMatch(input:any){
  return {
    roles:arr(input?.roles),userIds:arr(input?.userIds),projectIds:arr(input?.projectIds),departments:arr(input?.departments),
    sourceModules:arr(input?.sourceModules).map((x:string)=>x.slice(0,100)),priorities:arr(input?.priorities).filter((x:string)=>priorities.has(x)),
    colorModes:arr(input?.colorModes).filter((x:string)=>colors.has(x)),pageSizes:arr(input?.pageSizes).filter((x:string)=>pageSizes.has(x)),
    minImpressions:num(input?.minImpressions),maxImpressions:num(input?.maxImpressions),minCostMinor:num(input?.minCostMinor),maxCostMinor:num(input?.maxCostMinor),
    minCopies:num(input?.minCopies),maxCopies:num(input?.maxCopies)
  };
}
function normalizeAction(input:any){
  return {
    block:Boolean(input?.block),blockMessage:String(input?.blockMessage||"This print request is blocked by an organization Printerly policy.").slice(0,500),
    requireApproval:Boolean(input?.requireApproval),approverRoles:arr(input?.approverRoles).length?arr(input?.approverRoles):["owner","admin"],
    approverUserIds:arr(input?.approverUserIds),allowSelfApproval:Boolean(input?.allowSelfApproval),
    forceDuplex:Boolean(input?.forceDuplex),forceMonochrome:Boolean(input?.forceMonochrome),forceSecureRelease:Boolean(input?.forceSecureRelease),
    printerId:input?.printerId?String(input.printerId):null,priority:priorities.has(String(input?.priority))?String(input.priority):null
  };
}
function matches(rule:any,principal:any,body:any,prepared:any){
  const m=rule.match;
  if(m.roles.length&&!m.roles.includes(String(principal.role)))return false;
  if(m.userIds.length&&!m.userIds.includes(String(principal.userId)))return false;
  if(m.projectIds.length&&!m.projectIds.includes(String(body.projectId||"")))return false;
  const dept=body.departmentId?`${body.departmentType||"finance"}:${body.departmentId}`:"";
  if(m.departments.length&&!m.departments.includes(dept))return false;
  const source=String(body.sourceModule||"");
  if(m.sourceModules.length&&!m.sourceModules.some((x:string)=>source===x||source.startsWith(`${x}.`)||source.startsWith(`${x}/`)))return false;
  if(m.priorities.length&&!m.priorities.includes(String(body.priority||"normal")))return false;
  if(m.colorModes.length&&!m.colorModes.includes(String(body.colorMode||"monochrome")))return false;
  if(m.pageSizes.length&&!m.pageSizes.includes(String(body.pageSize||"A4")))return false;
  const impressions=Number(prepared?.estimatedImpressions||0),cost=Number(prepared?.estimate?.totalCostMinor||0),copies=Number(body.copies||1);
  if(m.minImpressions!==null&&impressions<m.minImpressions)return false;if(m.maxImpressions!==null&&impressions>m.maxImpressions)return false;
  if(m.minCostMinor!==null&&cost<m.minCostMinor)return false;if(m.maxCostMinor!==null&&cost>m.maxCostMinor)return false;
  if(m.minCopies!==null&&copies<m.minCopies)return false;if(m.maxCopies!==null&&copies>m.maxCopies)return false;
  return true;
}
function actionLabels(a:any){
  const labels:string[]=[];
  if(a.block)labels.push("Block");
  if(a.requireApproval)labels.push("Require approval");
  if(a.forceDuplex)labels.push("Force duplex");
  if(a.forceMonochrome)labels.push("Force B&W");
  if(a.forceSecureRelease)labels.push("Force secure release");
  if(a.printerId)labels.push("Route printer");
  if(a.priority)labels.push(`Force ${a.priority} priority`);
  return labels;
}

export async function ruleOptions(db:any,organizationId:string){
  const [users,projects,fd,sd,printers]=await Promise.all([
    db.prepare(`SELECT m.user_id id,u.display_name name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.display_name,u.email`).bind(organizationId).all<any>(),
    db.prepare("SELECT id,code,name FROM projects WHERE organization_id=? AND status='active' ORDER BY name").bind(organizationId).all<any>(),
    db.prepare("SELECT id,code,name FROM dimensions WHERE organization_id=? AND type='department' AND active=1 ORDER BY name").bind(organizationId).all<any>(),
    db.prepare("SELECT id,code,name FROM school_departments WHERE organization_id=? AND active=1 ORDER BY name").bind(organizationId).all<any>().catch(()=>({results:[]})),
    db.prepare("SELECT id,name,location,status FROM prn_printers WHERE organization_id=? ORDER BY name").bind(organizationId).all<any>()
  ]);
  return {roles:["owner","admin","manager","accountant","viewer","integration"],users:users.results||[],projects:projects.results||[],financeDepartments:fd.results||[],schoolDepartments:sd.results||[],printers:printers.results||[]};
}

export async function listRules(db:any,organizationId:string){
  const rows=(await db.prepare(`SELECT id,name,description,active,priority,match_json matchJson,action_json actionJson,created_by createdBy,updated_by updatedBy,created_at createdAt,updated_at updatedAt
    FROM prn_print_rules WHERE organization_id=? ORDER BY active DESC,priority,created_at`).bind(organizationId).all<any>()).results||[];
  return rows.map((r:any)=>({...r,active:Boolean(r.active),match:normalizeMatch(safeJson(r.matchJson,{})),action:normalizeAction(safeJson(r.actionJson,{}))}));
}

export async function saveRule(db:any,organizationId:string,userId:string,id:string|null,data:any){
  const name=String(data.name||"").trim().slice(0,160);if(!name)throw new AppError(422,"RULE_NAME_REQUIRED","Enter a Printerly policy name");
  const match=normalizeMatch(data.match||{}),action=normalizeAction(data.action||{});
  if(!actionLabels(action).length)throw new AppError(422,"RULE_ACTION_REQUIRED","Choose at least one policy action");
  if(action.printerId&&!await db.prepare("SELECT 1 FROM prn_printers WHERE id=? AND organization_id=?").bind(action.printerId,organizationId).first())throw new AppError(422,"INVALID_PRINTER","The policy routing printer does not belong to this organization");
  const memberIds=[...new Set([...match.userIds,...action.approverUserIds])];
  if(memberIds.length){const q=memberIds.map(()=>"?").join(",");const found=(await db.prepare(`SELECT user_id id FROM memberships WHERE organization_id=? AND user_id IN (${q})`).bind(organizationId,...memberIds).all<any>()).results||[];if(found.length!==memberIds.length)throw new AppError(422,"INVALID_POLICY_USER","One or more selected policy users are not organization members")}
  const priority=Math.max(1,Math.min(1000,Math.round(Number(data.priority)||100))),description=String(data.description||"").trim().slice(0,800),active=data.active===false?0:1;
  if(id){
    const r=await db.prepare(`UPDATE prn_print_rules SET name=?,description=?,active=?,priority=?,match_json=?,action_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
      .bind(name,description||null,active,priority,JSON.stringify(match),JSON.stringify(action),userId,id,organizationId).run();
    if(!r.meta?.changes)throw new AppError(404,"RULE_NOT_FOUND","Printerly policy not found");
    return {id,name,description,active:Boolean(active),priority,match,action};
  }
  const ruleId=makeId("prnrule");
  await db.prepare(`INSERT INTO prn_print_rules(id,organization_id,name,description,active,priority,match_json,action_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(ruleId,organizationId,name,description||null,active,priority,JSON.stringify(match),JSON.stringify(action),userId,userId).run();
  return {id:ruleId,name,description,active:Boolean(active),priority,match,action};
}

export async function deactivateRule(db:any,organizationId:string,id:string){
  const r=await db.prepare("UPDATE prn_print_rules SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND active=1").bind(id,organizationId).run();
  if(!r.meta?.changes)throw new AppError(404,"RULE_NOT_FOUND","Active Printerly policy not found");
  return {id,active:false};
}

export async function evaluatePrintPolicy(db:any,organizationId:string,principal:any,body:any,prepared:any){
  const rows=(await db.prepare("SELECT id,name,priority,match_json matchJson,action_json actionJson FROM prn_print_rules WHERE organization_id=? AND active=1 ORDER BY priority,created_at").bind(organizationId).all<any>()).results||[];
  const effective={...body},applied:any[]=[];let blocked=false,blockedReason="",requiresApproval=false,allowSelfApproval=true;
  const approverRoles=new Set<string>(),approverUserIds=new Set<string>(),approvalRuleIds:string[]=[];
  let routeChosen=false,priorityChosen=false;
  for(const row of rows){
    const rule={...row,match:normalizeMatch(safeJson(row.matchJson,{})),action:normalizeAction(safeJson(row.actionJson,{}))};
    if(!matches(rule,principal,body,prepared))continue;
    const a=rule.action,labels=actionLabels(a);applied.push({id:row.id,name:row.name,priority:row.priority,actions:labels});
    if(a.block&&!blocked){blocked=true;blockedReason=a.blockMessage}
    if(a.requireApproval){requiresApproval=true;approvalRuleIds.push(row.id);a.approverRoles.forEach((x:string)=>approverRoles.add(x));a.approverUserIds.forEach((x:string)=>approverUserIds.add(x));if(!a.allowSelfApproval)allowSelfApproval=false}
    if(a.forceDuplex)effective.duplex=true;
    if(a.forceMonochrome)effective.colorMode="monochrome";
    if(a.forceSecureRelease)effective.secureRelease=true;
    if(a.printerId&&!routeChosen){effective.printerId=a.printerId;routeChosen=true}
    if(a.priority&&!priorityChosen){effective.priority=a.priority;priorityChosen=true}
  }
  if(requiresApproval&&approverRoles.size===0&&approverUserIds.size===0){approverRoles.add("owner");approverRoles.add("admin")}
  const messages=applied.flatMap((r:any)=>r.actions.map((a:string)=>`${r.name}: ${a}`));
  return {blocked,blockedReason,requiresApproval,effective,applied,messages,approval:{ruleIds:approvalRuleIds,approverRoles:[...approverRoles],approverUserIds:[...approverUserIds],allowSelfApproval}};
}

export async function createPendingJob(db:any,organizationId:string,userId:string,data:any){
  const documentId=String(data.documentId||"").trim();if(!documentId)throw new AppError(422,"VALIDATION_ERROR","Upload a document before creating the print job");
  const doc=await db.prepare("SELECT id,mime_type mimeType,checksum_sha256 checksum,status FROM prn_documents WHERE id=? AND organization_id=?").bind(documentId,organizationId).first<any>();
  if(!doc||doc.status!=="staged")throw new AppError(409,"DOCUMENT_UNAVAILABLE","The uploaded document is missing, expired, or already attached");
  const printerId=data.printerId?String(data.printerId):null;
  if(printerId&&!await db.prepare("SELECT 1 FROM prn_printers WHERE id=? AND organization_id=?").bind(printerId,organizationId).first())throw new AppError(422,"INVALID_PRINTER","Selected printer does not belong to this organization");
  const priority=priorities.has(String(data.priority))?String(data.priority):"normal",pageSize=pageSizes.has(String(data.pageSize))?String(data.pageSize):"A4",colorMode=colors.has(String(data.colorMode))?String(data.colorMode):"monochrome";
  const jobId=makeId("prnjob"),created=now(),copies=Math.max(1,Math.min(1000,Number(data.copies)||1)),pages=Math.max(1,Math.min(10000,Number(data.estimatedPages)||1)),number=`PRT-${created.slice(0,4)}-${jobId.slice(-8).toUpperCase()}`;
  await db.batch([
    db.prepare(`INSERT INTO prn_jobs(id,organization_id,job_number,title,document_url,document_id,document_mime,document_sha256,printer_id,status,priority,copies,page_size,color_mode,duplex,secure_release,total_sheets,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'approval_pending',?,?,?,?,?,?,?,?,?,?)`).bind(jobId,organizationId,number,String(data.title||"Print job").trim().slice(0,200),`printerly-document:${documentId}`,documentId,doc.mimeType,doc.checksum,printerId,priority,copies,pageSize,colorMode,data.duplex?1:0,data.secureRelease?1:0,copies*pages,userId,created,created),
    db.prepare("UPDATE prn_documents SET status='attached',job_id=?,attached_at=? WHERE id=? AND organization_id=? AND status='staged'").bind(jobId,created,documentId,organizationId),
    db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(makeId("prnev"),organizationId,jobId,"approval_requested",userId,JSON.stringify({priority,copies,pageSize,colorMode,duplex:Boolean(data.duplex),secureRelease:Boolean(data.secureRelease)}),created)
  ]);
  return {id:jobId,jobNumber:number,status:"approval_pending"};
}

export async function createApproval(db:any,organizationId:string,userId:string,jobId:string,policy:any){
  const id=makeId("prnappr"),a=policy.approval||{};
  await db.prepare(`INSERT INTO prn_approvals(id,organization_id,job_id,rule_ids_json,status,requested_by,approver_roles_json,approver_user_ids_json,allow_self_approval)
    VALUES(?,?,?,?,'pending',?,?,?,?)`).bind(id,organizationId,jobId,JSON.stringify(a.ruleIds||[]),userId,JSON.stringify(a.approverRoles||["owner","admin"]),JSON.stringify(a.approverUserIds||[]),a.allowSelfApproval?1:0).run();
  return {id,status:"pending",jobId,approverRoles:a.approverRoles||[],approverUserIds:a.approverUserIds||[]};
}

export async function listApprovals(db:any,organizationId:string,principal:any,status?:string){
  const all=principal.role==="owner"||principal.role==="admin"||principal.scopes?.includes("admin:read");
  const args:any[]=[organizationId],parts=["a.organization_id=?"];
  if(status&&["pending","approved","rejected","cancelled"].includes(status)){parts.push("a.status=?");args.push(status)}
  if(!all){parts.push(`(a.requested_by=? OR EXISTS(SELECT 1 FROM json_each(a.approver_user_ids_json) WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(a.approver_roles_json) WHERE value=?))`);args.push(principal.userId,principal.userId,principal.role)}
  const rows=(await db.prepare(`SELECT a.id,a.job_id jobId,a.status,a.rule_ids_json ruleIdsJson,a.requested_by requestedBy,a.requested_at requestedAt,a.approver_roles_json approverRolesJson,
    a.approver_user_ids_json approverUserIdsJson,a.allow_self_approval allowSelfApproval,a.decided_by decidedBy,a.decided_at decidedAt,a.decision_note decisionNote,
    j.job_number jobNumber,j.title,j.priority,j.copies,j.page_size pageSize,j.color_mode colorMode,j.duplex,j.secure_release secureRelease,j.estimated_impressions estimatedImpressions,j.estimated_cost_minor estimatedCostMinor,
    u.display_name requesterName,u.email requesterEmail
    FROM prn_approvals a JOIN prn_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id LEFT JOIN users u ON u.id=a.requested_by
    WHERE ${parts.join(" AND ")} ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT 200`).bind(...args).all<any>()).results||[];
  return rows.map((r:any)=>({...r,ruleIds:safeJson(r.ruleIdsJson,[]),approverRoles:safeJson(r.approverRolesJson,[]),approverUserIds:safeJson(r.approverUserIdsJson,[]),allowSelfApproval:Boolean(r.allowSelfApproval),duplex:Boolean(r.duplex),secureRelease:Boolean(r.secureRelease)}));
}

export async function decideApproval(db:any,organizationId:string,principal:any,id:string,decision:"approved"|"rejected",note:string){
  const row=await db.prepare(`SELECT a.*,j.status jobStatus,j.secure_release secureRelease,j.job_number jobNumber,j.title FROM prn_approvals a JOIN prn_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id WHERE a.id=? AND a.organization_id=?`).bind(id,organizationId).first<any>();
  if(!row)throw new AppError(404,"APPROVAL_NOT_FOUND","Printerly approval request not found");
  if(row.status!=="pending")throw new AppError(409,"APPROVAL_DECIDED","This Printerly approval has already been decided");
  if(row.jobStatus!=="approval_pending")throw new AppError(409,"JOB_NOT_PENDING_APPROVAL","This print job is no longer waiting for approval");
  const roles=safeJson(row.approver_roles_json,[]),users=safeJson(row.approver_user_ids_json,[]);
  const can=principal.role==="owner"||principal.role==="admin"||roles.includes(principal.role)||users.includes(principal.userId);
  if(!can)throw new AppError(403,"APPROVER_REQUIRED","You are not an authorized approver for this print job");
  if(row.requested_by===principal.userId&&!Boolean(row.allow_self_approval))throw new AppError(403,"SELF_APPROVAL_FORBIDDEN","This policy does not allow the requester to approve their own print job");
  const nonce=crypto.randomUUID(),t=now(),next=decision==="approved"?(row.secureRelease?"held":"queued"):"cancelled",message=decision==="rejected"?`Rejected: ${String(note||"No reason supplied").slice(0,500)}`:null;
  const results=await db.batch([
    db.prepare(`UPDATE prn_approvals SET status=?,decided_by=?,decided_at=?,decision_note=?,decision_nonce=? WHERE id=? AND organization_id=? AND status='pending'`).bind(decision,principal.userId,t,String(note||"").slice(0,1000)||null,nonce,id,organizationId),
    db.prepare(`UPDATE prn_jobs SET status=?,error_message=?,updated_at=? WHERE id=? AND organization_id=? AND status='approval_pending' AND EXISTS(SELECT 1 FROM prn_approvals WHERE id=? AND organization_id=? AND decision_nonce=?)`).bind(next,message,t,row.job_id,organizationId,id,organizationId,nonce)
  ]);
  if(!results[0]?.meta?.changes)throw new AppError(409,"APPROVAL_DECIDED","This Printerly approval changed while you were deciding it");
  if(!results[1]?.meta?.changes)throw new AppError(409,"JOB_NOT_PENDING_APPROVAL","The print job changed while the approval was being decided");
  await db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(makeId("prnev"),organizationId,row.job_id,decision==="approved"?"approval_approved":"approval_rejected",principal.userId,JSON.stringify({approvalId:id,note:String(note||"").slice(0,1000),nextStatus:next}),t).run();
  return {id,jobId:row.job_id,jobNumber:row.jobNumber,status:decision,jobStatus:next,releaseQuota:decision==="rejected"};
}

export async function cancelPendingApproval(db:any,organizationId:string,userId:string,jobId:string){
  const row=await db.prepare("SELECT a.id approvalId FROM prn_approvals a JOIN prn_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id WHERE a.organization_id=? AND a.job_id=? AND a.status='pending' AND j.status='approval_pending'").bind(organizationId,jobId).first<any>();
  if(!row)return null;
  const t=now();
  const results=await db.batch([
    db.prepare("UPDATE prn_jobs SET status='cancelled',updated_at=? WHERE id=? AND organization_id=? AND status='approval_pending'").bind(t,jobId,organizationId),
    db.prepare("UPDATE prn_approvals SET status='cancelled',decided_by=?,decided_at=?,decision_note='Cancelled by requester or administrator' WHERE id=? AND organization_id=? AND status='pending'").bind(userId,t,row.approvalId,organizationId)
  ]);
  if(!results[0]?.meta?.changes)return null;
  await db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(makeId("prnev"),organizationId,jobId,"approval_cancelled",userId,"{}",t).run();
  return {id:jobId,status:"cancelled",approvalId:row.approvalId};
}


export async function abortPendingJob(db:any,organizationId:string,userId:string,jobId:string){
  const t=now(),r=await db.prepare("UPDATE prn_jobs SET status='cancelled',updated_at=? WHERE id=? AND organization_id=? AND status='approval_pending'").bind(t,jobId,organizationId).run();
  if(r.meta?.changes)await db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(makeId("prnev"),organizationId,jobId,"approval_aborted",userId,"{}",t).run();
  return {id:jobId,status:"cancelled",changed:Boolean(r.meta?.changes)};
}
