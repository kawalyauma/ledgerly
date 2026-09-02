import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";
import type { AppVariables, Env, ReportJobMessage, WebhookJobMessage } from "./types";
import { AppError } from "./lib/errors";
import { requireAuth } from "./lib/auth";
import { accountsRoutes } from "./routes/accounts";
import { journalsRoutes } from "./routes/journals";
import { reportsRoutes } from "./routes/reports";
import { systemRoutes } from "./routes/system";
import { contactsRoutes } from "./routes/contacts";
import { productsRoutes } from "./routes/products";
import { documentsRoutes } from "./routes/documents";
import { paymentsRoutes } from "./routes/payments";
import { periodsRoutes } from "./routes/periods";
import { inventoryRoutes } from "./routes/inventory";
import { projectsRoutes } from "./routes/projects";
import { budgetsRoutes } from "./routes/budgets";
import { ordersRoutes } from "./routes/orders";
import { payrollRoutes } from "./routes/payroll";
import { dashboardsRoutes } from "./routes/dashboards";
import { reportSchedulesRoutes } from "./routes/report-schedules";
import { createId } from "./lib/ids";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { integrationsRoutes } from "./routes/integrations";
import { reportLibraryRoutes } from "./routes/report-library";
import { organizationsRoutes } from "./routes/organizations";
import { dimensionsRoutes } from "./routes/dimensions";
import { taxRoutes } from "./routes/tax";
import { bankingRoutes } from "./routes/banking";
import { operationsRoutes } from "./routes/operations";
import { consumeWebhooks } from "./services/webhooks";
import { consumeReports } from "./worker/report-consumer";
import { openapiDocument } from "./openapi";
import { closingRoutes } from "./routes/closing";
import { complianceRoutes } from "./routes/compliance";
import { createDocument, postDocument } from "./services/documents";
import { createJournal, postJournal } from "./services/ledger";
import { documentRenderingRoutes } from "./routes/document-rendering";
import { financeMaintenanceRoutes } from "./routes/finance-maintenance";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", requestId());
app.use("*", secureHeaders());
app.use("/api/*", cors({ origin: [], allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-API-Key", "X-Organization-Id", "X-User-Id"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], maxAge: 86400 }));

app.route("/system", systemRoutes);
app.route("/auth", authRoutes);
app.get("/openapi.json", (c) => c.json(openapiDocument));
app.get("/docs", (c) => c.html(`<!doctype html><html><head><title>Your Finance Pro API</title><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><script id="api-reference" data-url="/openapi.json"></script><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`));
app.use("/api/v1/*", requireAuth);
app.route("/api/v1/accounts", accountsRoutes);
app.route("/api/v1/journals", journalsRoutes);
app.route("/api/v1/reports", reportsRoutes);
app.route("/api/v1/contacts", contactsRoutes);
app.route("/api/v1/products", productsRoutes);
app.route("/api/v1/documents", documentsRoutes);
app.route("/api/v1/document-rendering",documentRenderingRoutes);
app.route("/api/v1/payments", paymentsRoutes);
app.route("/api/v1/fiscal-periods", periodsRoutes);
app.route("/api/v1/inventory", inventoryRoutes);
app.route("/api/v1/projects", projectsRoutes);
app.route("/api/v1/budgets", budgetsRoutes);
app.route("/api/v1/orders", ordersRoutes);
app.route("/api/v1/payroll", payrollRoutes);
app.route("/api/v1/dashboards", dashboardsRoutes);
app.route("/api/v1/report-schedules", reportSchedulesRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/integrations", integrationsRoutes);
app.route("/api/v1/report-library", reportLibraryRoutes);
app.route("/api/v1/organizations",organizationsRoutes);
app.route("/api/v1/dimensions",dimensionsRoutes);
app.route("/api/v1/tax",taxRoutes);
app.route("/api/v1/banking",bankingRoutes);
app.route("/api/v1/operations",operationsRoutes);
app.route("/api/v1/finance-maintenance",financeMaintenanceRoutes);
app.route("/api/v1/closing", closingRoutes);
app.route("/api/v1/compliance", complianceRoutes);
app.get("/", (c) => c.json({ name: "Your Finance Pro API", version: "0.1.0", documentation: "/docs", health: "/system/health" }));
app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: c.get("requestId" as never) } }, 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ level: "error", requestId: c.get("requestId" as never), message: error.message, stack: error.stack }));
  if (error instanceof AppError) return c.json({ error: { code: error.code, message: error.message, details: error.details, requestId: c.get("requestId" as never) } }, error.status);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: c.get("requestId" as never) } }, 500);
});

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<ReportJobMessage | WebhookJobMessage>, env: Env) => batch.queue === "finance-webhook-jobs"
    ? consumeWebhooks(batch as MessageBatch<WebhookJobMessage>, env)
    : consumeReports(batch as MessageBatch<ReportJobMessage>, env),
  scheduled: async (_controller: ScheduledController, env: Env) => {
    await env.FINANCE_DB.prepare("DELETE FROM report_jobs WHERE status = 'failed' AND created_at < datetime('now', '-30 days')").run();
    const due=await env.FINANCE_DB.prepare(`SELECT id,organization_id AS organizationId,report_type AS reportType,format,filters,cron AS cadence
      FROM report_schedules WHERE active=1 AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at LIMIT 50`).all<{id:string;organizationId:string;reportType:string;format:"json"|"csv"|"xlsx"|"pdf";filters:string;cadence:string}>();
    for(const schedule of due.results){const jobId=createId("rpt");await env.FINANCE_DB.prepare(`INSERT INTO report_jobs (id,organization_id,requested_by,report_type,format,filters,status) VALUES (?,?,'scheduler',?,?,?,'queued')`).bind(jobId,schedule.organizationId,schedule.reportType,schedule.format,schedule.filters).run();await env.REPORT_QUEUE.send({jobId,organizationId:schedule.organizationId,reportType:schedule.reportType,format:schedule.format,filters:JSON.parse(schedule.filters)},{contentType:"json"});const modifier=schedule.cadence==="hourly"?"+1 hour":schedule.cadence==="weekly"?"+7 days":schedule.cadence==="monthly"?"+1 month":"+1 day";await env.FINANCE_DB.prepare("UPDATE report_schedules SET last_run_at=CURRENT_TIMESTAMP,next_run_at=datetime(CURRENT_TIMESTAMP,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(modifier,schedule.id).run()}
    const recurring=await env.FINANCE_DB.prepare("SELECT id,organization_id AS organizationId,type,template_json AS template,cadence,auto_post AS autoPost FROM recurring_templates WHERE active=1 AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at LIMIT 50").all<{id:string;organizationId:string;type:"invoice"|"bill"|"journal";template:string;cadence:string;autoPost:number}>();
    for(const item of recurring.results){const template=JSON.parse(item.template) as any;try{if(item.type==="journal"){const journal=await createJournal(env.FINANCE_DB,item.organizationId,"scheduler",template,`recurring:${item.id}:${new Date().toISOString().slice(0,10)}`);if(item.autoPost)await postJournal(env.FINANCE_DB,item.organizationId,"scheduler",journal.id)}else{const document=await createDocument(env.FINANCE_DB,item.organizationId,"scheduler",{...template,type:item.type});if(item.autoPost&&template.controlAccountId)await postDocument(env.FINANCE_DB,item.organizationId,"scheduler",document.id,template.controlAccountId)}const modifier=item.cadence==="weekly"?"+7 days":item.cadence==="quarterly"?"+3 months":item.cadence==="yearly"?"+1 year":"+1 month";await env.FINANCE_DB.prepare("UPDATE recurring_templates SET last_run_at=CURRENT_TIMESTAMP,next_run_at=datetime(CURRENT_TIMESTAMP,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(modifier,item.id).run()}catch(error){console.error(JSON.stringify({level:"error",recurringTemplateId:item.id,message:error instanceof Error?error.message:String(error)}))}}
  },
} satisfies ExportedHandler<Env, ReportJobMessage | WebhookJobMessage>;
