export interface Env {
  FINANCE_DB: D1Database;
  REPORTS_BUCKET: R2Bucket;
  REPORT_QUEUE: Queue<ReportJobMessage>;
  WEBHOOK_QUEUE: Queue<WebhookJobMessage>;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
}

export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "accountant" | "manager" | "viewer" | "integration";
  scopes: string[];
}

export interface AppVariables {
  principal: AuthPrincipal;
}

export interface ReportJobMessage {
  kind?: "report";
  jobId: string;
  organizationId: string;
  reportType: string;
  filters: Record<string, string | number | boolean | null>;
  format: "json" | "csv" | "xlsx" | "pdf";
}

export interface WebhookJobMessage { kind:"webhook";deliveryId:string;organizationId:string }
