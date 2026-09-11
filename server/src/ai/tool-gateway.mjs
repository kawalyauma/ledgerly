import { evaluateToolPolicy } from "./policy.mjs";

const object=(properties={},required=[])=>({type:"object",properties,required,additionalProperties:false});
const string=(description)=>({type:"string",description});
const integer=(description,minimum=1,maximum=100)=>({type:"integer",description,minimum,maximum});
const array=(description)=>({type:"array",description,items:{}});
const TOOL_META=Object.freeze({
 search_students:{description:"Search students in the current organization by admission number, student number or name.",parameters:object({query:string("Student name, admission number or student number."),limit:integer("Maximum results.",1,50)})},
 get_student:{description:"Get one student in the current organization by ID, admission number or student number.",parameters:object({studentId:string("Student ID, admission number or student number.")},["studentId"])},
 get_staff:{description:"Find staff in the current organization by ID, user ID, staff number or name.",parameters:object({query:string("Staff ID, user ID, staff number or name."),limit:integer("Maximum results.",1,50)})},
 get_school_profile:{description:"Read the current organization's school profile.",parameters:object()},
 get_academic_context:{description:"Read tenant-scoped academic context including year, term, class, stream, mapped subjects, curriculum, lesson-plan templates, schemes, scheme items and recent lesson plans.",parameters:object({academicYearId:string("Optional academic year ID."),termId:string("Optional term ID."),classId:string("Optional class ID. When supplied, subjects are restricted to that class level/year mapping."),subjectId:string("Optional subject ID."),teacherUserId:string("Optional teacher user ID."),weekNo:integer("Optional academic week number.",1,60)})},
 get_lesson_plan:{description:"Read one lesson plan in the current organization.",parameters:object({lessonPlanId:string("Lesson plan ID.")},["lessonPlanId"])},
 create_lesson_plan_draft:{description:"Create a structured AI-authored lesson-plan draft. This never officially approves the plan.",parameters:object({title:string("Draft title."),content:{type:"object",description:"Structured lesson-plan content."}},["content"])},
 update_document_draft:{description:"Revise an editable AI Workforce document draft while preserving provenance.",parameters:object({documentId:string("AI Workforce document ID."),content:{type:"object",description:"Complete replacement structured content."}},["documentId","content"])},
 record_academic_review:{description:"Record an AI academic review. The result is advisory and never official approval.",parameters:object({documentId:string("Lesson-plan document ID."),recommendation:{type:"string",enum:["recommended_for_approval","changes_requested"]},findings:array("Review findings."),sourceReferences:array("Supporting source references.")},["documentId","recommendation"])},
 get_student_balance:{description:"Read the current school-fee balance for one student.",parameters:object({studentId:string("Student ID.")},["studentId"])},
 get_finance_summary:{description:"Read posted-journal debit, credit and journal counts for an optional date range.",parameters:object({from:string("Optional start date YYYY-MM-DD."),to:string("Optional end date YYYY-MM-DD.")})},
 find_finance_anomalies:{description:"Find posted journal entries whose debits and credits are not balanced.",parameters:object({limit:integer("Maximum anomalies.",1,100)})},
 find_unmatched_payments:{description:"Find school-fee receipts with an unallocated amount remaining.",parameters:object({limit:integer("Maximum receipts.",1,100)})},
 get_inventory_summary:{description:"Read current inventory quantities, average cost and reorder status.",parameters:object({limit:integer("Maximum products.",1,100)})},
 run_consistency_checks:{description:"Run safe read-only Ledgerly consistency checks for the current organization.",parameters:object()},
 get_system_status:{description:"Read tenant-safe Ledgerly AI/runtime health information.",parameters:object()},
 prepare_fee_reminder:{description:"Prepare a non-sent fee reminder draft using the authoritative current student balance.",parameters:object({studentId:string("Student ID."),tone:{type:"string",enum:["neutral","friendly","firm"],description:"Optional reminder tone."},dueDate:string("Optional due date or payment date text.")},["studentId"])},
 create_task:{description:"Delegate work to another active AI employee through a durable audited child task.",parameters:object({assignedAgent:string("Target AI employee ID."),instruction:string("Task instruction.")},["assignedAgent","instruction"])},
 send_notification:{description:"Send a Ledgerly notification. This consequential action always requires human approval.",parameters:object({channel:string("Notification channel/provider."),to:string("Recipient/address/phone understood by the configured provider."),message:string("Exact approved message content."),subject:string("Optional subject."),deliveryId:string("Optional idempotent delivery ID.")},["channel","to","message"])},
 generate_report:{description:"Prepare a structured unpublished report draft from supplied report content.",parameters:object({title:string("Report title."),content:{type:"object",description:"Structured report content."}},["title","content"])},
 request_approval:{description:"Pause the current AI task and request explicit human approval of a proposed action or decision.",parameters:object({action:string("Proposed action or decision requiring human approval."),reason:string("Why approval is required."),payload:{type:"object",description:"Exact proposal/payload for the human reviewer."},riskLevel:{type:"string",enum:["low","medium","high"]},requestedApprover:string("Optional intended approver ID.")},["action","reason"])},
});

function inputError(message){const error=new Error(message);error.code="AI_TOOL_INPUT_INVALID";error.status=422;return error;}
function validateSchema(schema,value,path="input"){
 if(!schema?.type)return;
 if(schema.type==="object"){
  if(value==null||typeof value!=="object"||Array.isArray(value))throw inputError(`${path} must be an object`);
  const props=schema.properties??{};for(const key of schema.required??[])if(value[key]===undefined||value[key]===null||value[key]==="")throw inputError(`${path}.${key} is required`);
  if(schema.additionalProperties===false)for(const key of Object.keys(value))if(!Object.prototype.hasOwnProperty.call(props,key))throw inputError(`${path}.${key} is not allowed`);
  for(const [key,child] of Object.entries(props))if(value[key]!==undefined)validateSchema(child,value[key],`${path}.${key}`);return;
 }
 if(schema.type==="string"){if(typeof value!=="string")throw inputError(`${path} must be a string`);if(schema.enum&&!schema.enum.includes(value))throw inputError(`${path} must be one of ${schema.enum.join(", ")}`);return;}
 if(schema.type==="integer"){if(!Number.isInteger(value))throw inputError(`${path} must be an integer`);if(schema.minimum!=null&&value<schema.minimum)throw inputError(`${path} must be at least ${schema.minimum}`);if(schema.maximum!=null&&value>schema.maximum)throw inputError(`${path} must be at most ${schema.maximum}`);return;}
 if(schema.type==="array"){if(!Array.isArray(value))throw inputError(`${path} must be an array`);for(let i=0;i<value.length;i++)validateSchema(schema.items,value[i],`${path}[${i}]`);return;}
}
function validateToolInput(tool,input){validateSchema(tool.parameters??object(),input??{},tool.name);}

export class AiToolGateway {
  constructor({ audit, approvalService = null }) { this.audit=audit; this.approvalService=approvalService; this.tools=new Map(); }
  register(definition,handler){if(!definition?.name||typeof handler!=="function")throw new TypeError("tool definition and handler are required");const meta=TOOL_META[definition.name]??{};this.tools.set(definition.name,Object.freeze({...meta,...definition,handler}));return this;}
  describeAll(){return [...this.tools.values()].map(({handler,...tool})=>tool).sort((a,b)=>a.name.localeCompare(b.name));}
  describeForAgent(agent){return this.describeAll().filter((tool)=>(agent.allowedTools??[]).includes(tool.name));}

  async invoke({agent,context,taskId=null,toolName,input={}}){
    const tool=this.tools.get(toolName);if(!tool){const error=new Error(`Unknown AI tool: ${toolName}`);error.code="AI_TOOL_NOT_ALLOWED";throw error;}
    validateToolInput(tool,input);
    const policy=evaluateToolPolicy({agent,tool,context,input});
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.tool.requested",entity_type:"ai_tool",entity_id:toolName,reason:context.reason??null,metadata:{task_id:taskId,policy,input:tool.auditInput===false?undefined:input,authorized_by:context.authority?.userId??context.userId??null}});
    if(policy.decision==="approval_required"){
      if(!this.approvalService)return {status:"waiting_for_approval",policy};
      const approval=await this.approvalService.request({organizationId:context.organizationId,agent,taskId,action:toolName,reason:context.reason??policy.reason,payload:input,riskLevel:policy.risk,requestedApprover:tool.requestedApprover??null});
      return {status:"waiting_for_approval",approval,policy};
    }
    return this.#execute({tool,agent,context,taskId,input,approved:false});
  }

  async executeApproved({approval,agent,context}){
    if(!approval||approval.organization_id!==context.organizationId)throw new Error("approval is outside organization scope");
    if(approval.status!=="approved")throw new Error("approval is not approved");
    if(approval.agent_id!==agent.agentId)throw new Error("approval agent mismatch");
    const tool=this.tools.get(approval.requested_action);if(!tool)throw new Error(`Unknown approved AI tool: ${approval.requested_action}`);
    if(!(agent.allowedTools??[]).includes(tool.name)){const error=new Error("agent no longer has permission for approved tool");error.code="AI_TOOL_NOT_ALLOWED";throw error;}
    validateToolInput(tool,approval.payload??{});
    const currentPermissions=context.permissions??[];
    const effectivePermissions=intersect(agent.permissions??[],currentPermissions);
    evaluateToolPolicy({agent:{...agent,permissions:effectivePermissions},tool,context:{...context,permissions:effectivePermissions,approvalGranted:true},input:approval.payload??{}});
    let claimed=approval;
    if(this.approvalService?.claimExecution)claimed=await this.approvalService.claimExecution({context,approvalId:approval.approval_id});
    try{
      const result=await this.#execute({tool,agent,context:{...context,permissions:effectivePermissions,reason:approval.reason},taskId:approval.task_id,input:approval.payload??{},approved:true,approvalId:approval.approval_id});
      if(this.approvalService?.markExecuted)await this.approvalService.markExecuted({context,approvalId:approval.approval_id,result});
      return result;
    }catch(error){
      if(claimed?.status==="executing"&&this.approvalService?.releaseExecution)await this.approvalService.releaseExecution({context,approvalId:approval.approval_id,reason:error instanceof Error?error.message:String(error)}).catch(()=>undefined);
      throw error;
    }
  }

  async #execute({tool,agent,context,taskId,input,approved,approvalId=null}){
    const toolContext={...context,provenance:context.provenance??{actor_type:"ai_agent",agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,task_id:taskId,timestamp:new Date().toISOString(),reason:context.reason??null}};
    const output=await tool.handler({input,context:toolContext,agent,taskId,approved,approvalId});
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.tool.executed",entity_type:"ai_tool",entity_id:tool.name,reason:context.reason??null,metadata:{task_id:taskId,risk:tool.risk??"low",approved,approval_id:approvalId}});
    return {status:"executed",output,policy:{decision:"allow",risk:tool.risk??"low",approved}};
  }
}

export function registerCoreTools(gateway,services={}){
  const register=(name,permissions,handler,extra={})=>gateway.register({name,permissions,risk:"low",consequential:false,...extra},handler);
  register("search_students",["students:read"],services.searchStudents??unavailable("search_students"));
  register("get_student",["students:read"],services.getStudent??unavailable("get_student"));
  register("get_staff",["staff:read"],services.getStaff??unavailable("get_staff"));
  register("get_school_profile",["school:read"],services.getSchoolProfile??unavailable("get_school_profile"));
  register("get_academic_context",["academics:read"],services.getAcademicContext??unavailable("get_academic_context"));
  register("get_lesson_plan",["academics:read"],services.getLessonPlan??unavailable("get_lesson_plan"));
  register("create_lesson_plan_draft",["academics:write"],services.createLessonPlanDraft??unavailable("create_lesson_plan_draft"));
  register("update_document_draft",["documents:write"],services.updateDocumentDraft??unavailable("update_document_draft"));
  register("record_academic_review",["academics:read"],services.recordAcademicReview??unavailable("record_academic_review"));
  register("get_student_balance",["fees:read"],services.getStudentBalance??unavailable("get_student_balance"));
  register("get_finance_summary",["finance:read"],services.getFinanceSummary??unavailable("get_finance_summary"));
  register("find_finance_anomalies",["finance:read"],services.findFinanceAnomalies??unavailable("find_finance_anomalies"));
  register("find_unmatched_payments",["finance:read"],services.findUnmatchedPayments??unavailable("find_unmatched_payments"));
  register("get_inventory_summary",["inventory:read"],services.getInventorySummary??unavailable("get_inventory_summary"));
  register("run_consistency_checks",["reports:read"],services.runConsistencyChecks??unavailable("run_consistency_checks"));
  register("get_system_status",["support:read"],services.getSystemStatus??unavailable("get_system_status"));
  register("prepare_fee_reminder",["fees:read"],services.prepareFeeReminder??unavailable("prepare_fee_reminder"));
  register("create_task",["tasks:write"],services.createTask??unavailable("create_task"));
  register("send_notification",["notifications:send"],services.sendNotification??unavailable("send_notification"),{risk:"medium",consequential:true,approvalRequired:true});
  register("generate_report",["reports:read"],services.generateReport??unavailable("generate_report"));
  register("request_approval",["approvals:write"],approvalAcknowledgement,{risk:"medium",consequential:true,approvalRequired:true});
  for(const name of ["delete_student","alter_marks","reverse_journal","post_payroll","post_payment","alter_financial_record","adjust_stock"]){
    gateway.register({name,description:"Prohibited AI action. Ledgerly requires a human-operated domain workflow instead.",parameters:object(),permissions:["ai:restricted"],risk:"prohibited",consequential:true,approvalRequired:false},prohibited(name));
  }
  return gateway;
}
function intersect(left,right){const b=new Set(right??[]);if(b.has("*"))return [...new Set(left??[])];return [...new Set(left??[])].filter((x)=>b.has(x));}
function unavailable(name){return async()=>{const error=new Error(`Ledgerly business adapter for ${name} is not connected yet`);error.code="AI_TOOL_ADAPTER_UNAVAILABLE";throw error;};}
function prohibited(name){return async()=>{const error=new Error(`${name} is prohibited for AI execution`);error.code="AI_ACTION_PROHIBITED";throw error;};}
async function approvalAcknowledgement({input,approved,approvalId,taskId}){return {approved:approved===true,approvalId:approvalId??null,taskId:taskId??null,request:input};}
