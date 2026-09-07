import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";
import type { AppVariables, Env, ReportJobMessage, WebhookJobMessage, WorkNotificationJob, CommunicationJob } from "./types";
import { AppError } from "./lib/errors";
import { requireAuth } from "./lib/auth";
import { systemRoutes } from "./routes/system";
import { createId } from "./lib/ids";
import { authRoutes } from "./routes/auth";
import { consumeWebhooks } from "./services/webhooks";
import { consumeReports } from "./worker/report-consumer";
import { openapiDocument } from "./openapi";
import { createDocument, postDocument } from "./services/documents";
import { createJournal, postJournal } from "./services/ledger";
import { backendModules } from "../modules/backend-registry.generated";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", requestId());
app.use("*", secureHeaders());
app.use("/api/*", cors({ origin: [], allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-API-Key", "X-Organization-Id", "X-User-Id"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], maxAge: 86400 }));

app.route("/system", systemRoutes);
app.route("/auth", authRoutes);
app.get("/openapi.json", (c) => c.json(openapiDocument));
app.get("/docs", (c) => c.html(`<!doctype html><html><head><title>Your Finance Pro API</title><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><script id="api-reference" data-url="/openapi.json"></script><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`));
for (const module of backendModules) {
  for (const mount of module.publicRoutes ?? []) app.route(mount.basePath, mount.router);
}
app.use("/api/v1/*", requireAuth);
for (const module of backendModules) {
  for (const mount of module.routes) app.route(mount.basePath, mount.router);
}
app.get("/", (c) => c.json({ name: "Ledgerly API", version: "0.2.0", modules: backendModules.map(m => ({ key: m.key, version: m.version })), documentation: "/docs", health: "/system/health" }));
app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: c.get("requestId" as never) } }, 404));
app.onError((error, c) => {
  const requestId=c.get("requestId" as never);
  console.error(JSON.stringify({ level: "error", requestId, message: error.message, stack: error.stack }));
  if (error instanceof AppError) return c.json({ error: { code: error.code, message: error.message, details: error.details, requestId } }, error.status);
  const raw=error instanceof Error?error.message:String(error);
  const lower=raw.toLowerCase();
  let status=500,code="INTERNAL_ERROR",message="The request could not be completed.";
  if(lower.includes("unique constraint failed")){
    status=409;code="DUPLICATE_RECORD";
    if(lower.includes("school_class_levels.organization_id")&&lower.includes("sequence"))message="That class-level sequence is already assigned. Choose a different sequence number.";
    else if(lower.includes("school_class_levels.organization_id")&&lower.includes("code"))message="That class-level code is already in use. Choose a different code.";
    else if(lower.includes("school_terms.organization_id")&&lower.includes("sequence"))message="That term/semester sequence is already assigned in this academic year.";
    else if(lower.includes("school_staff_subjects"))message="This subject is already assigned to the selected staff member.";
    else if(lower.includes("school_staff_teaching_assignments"))message="This teaching assignment already exists for the selected staff member, class, stream, subject and period.";
    else message="A record with the same unique value already exists. Change the duplicated code, number, sequence or assignment and try again.";
  }else if(lower.includes("foreign key constraint failed")){
    status=409;code="RELATED_RECORD_CONFLICT";message="This change conflicts with related records. Select valid referenced records, or remove dependent records before deleting this item.";
  }else if(lower.includes("not null constraint failed")){
    status=422;code="REQUIRED_FIELD_MISSING";message="A required value is missing. Check the form and complete all required fields.";
  }else if(lower.includes("check constraint failed")){
    status=422;code="INVALID_VALUE";message="One of the supplied values is outside the allowed range or status options.";
  }else if(c.env.ENVIRONMENT==="development"){
    message=raw||message;
  }
  return c.json({ error: { code, message, requestId } }, status as 409|422|500);
});

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<ReportJobMessage | WebhookJobMessage | WorkNotificationJob | CommunicationJob>, env: Env) => {
    for (const module of backendModules) {
      const handler = module.queues?.[batch.queue];
      if (handler) return handler(batch as MessageBatch<any>, env);
    }
    if (batch.queue === "finance-webhook-jobs") return consumeWebhooks(batch as MessageBatch<WebhookJobMessage>, env);
    if (batch.queue === "finance-report-jobs") return consumeReports(batch as MessageBatch<ReportJobMessage>, env);
    console.warn(JSON.stringify({ level: "warn", message: "No queue handler registered", queue: batch.queue }));
  },
  scheduled: async (controller: ScheduledController, env: Env) => {
    for (const module of backendModules) await module.scheduled?.(env, controller);
    // Ledgerly finance/report recurring work keeps its original hourly cadence.
    if (controller.cron !== "0 * * * *") return;
    await env.FINANCE_DB.prepare("DELETE FROM report_jobs WHERE status = 'failed' AND created_at < datetime('now', '-30 days')").run();
    const due=await env.FINANCE_DB.prepare(`SELECT id,organization_id AS organizationId,report_type AS reportType,format,filters,cron AS cadence
      FROM report_schedules WHERE active=1 AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at LIMIT 50`).all<{id:string;organizationId:string;reportType:string;format:"json"|"csv"|"xlsx"|"pdf";filters:string;cadence:string}>();
    for(const schedule of due.results){const jobId=createId("rpt");await env.FINANCE_DB.prepare(`INSERT INTO report_jobs (id,organization_id,requested_by,report_type,format,filters,status) VALUES (?,?,'scheduler',?,?,?,'queued')`).bind(jobId,schedule.organizationId,schedule.reportType,schedule.format,schedule.filters).run();await env.REPORT_QUEUE.send({jobId,organizationId:schedule.organizationId,reportType:schedule.reportType,format:schedule.format,filters:JSON.parse(schedule.filters)},{contentType:"json"});const modifier=schedule.cadence==="hourly"?"+1 hour":schedule.cadence==="weekly"?"+7 days":schedule.cadence==="monthly"?"+1 month":"+1 day";await env.FINANCE_DB.prepare("UPDATE report_schedules SET last_run_at=CURRENT_TIMESTAMP,next_run_at=datetime(CURRENT_TIMESTAMP,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(modifier,schedule.id).run()}
    const recurring=await env.FINANCE_DB.prepare("SELECT id,organization_id AS organizationId,type,template_json AS template,cadence,auto_post AS autoPost FROM recurring_templates WHERE active=1 AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at LIMIT 50").all<{id:string;organizationId:string;type:"invoice"|"bill"|"journal";template:string;cadence:string;autoPost:number}>();
    for(const item of recurring.results){const template=JSON.parse(item.template) as any;try{if(item.type==="journal"){const journal=await createJournal(env.FINANCE_DB,item.organizationId,"scheduler",template,`recurring:${item.id}:${new Date().toISOString().slice(0,10)}`);if(item.autoPost)await postJournal(env.FINANCE_DB,item.organizationId,"scheduler",journal.id)}else{const document=await createDocument(env.FINANCE_DB,item.organizationId,"scheduler",{...template,type:item.type});if(item.autoPost&&template.controlAccountId)await postDocument(env.FINANCE_DB,item.organizationId,"scheduler",document.id,template.controlAccountId)}const modifier=item.cadence==="weekly"?"+7 days":item.cadence==="quarterly"?"+3 months":item.cadence==="yearly"?"+1 year":"+1 month";await env.FINANCE_DB.prepare("UPDATE recurring_templates SET last_run_at=CURRENT_TIMESTAMP,next_run_at=datetime(CURRENT_TIMESTAMP,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(modifier,item.id).run()}catch(error){console.error(JSON.stringify({level:"error",recurringTemplateId:item.id,message:error instanceof Error?error.message:String(error)}))}}
  },
} satisfies ExportedHandler<Env, ReportJobMessage | WebhookJobMessage | WorkNotificationJob | CommunicationJob>;
