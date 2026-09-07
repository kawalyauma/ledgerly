export interface Env {
  FINANCE_DB: D1Database;
  REPORTS_BUCKET: R2Bucket;
  WORK_FILES_BUCKET: R2Bucket;
  REPORT_QUEUE: Queue<ReportJobMessage>;
  WEBHOOK_QUEUE: Queue<WebhookJobMessage>;
  WORK_NOTIFICATION_QUEUE: Queue<WorkNotificationJob>;
  COMMUNICATION_QUEUE: Queue<CommunicationJob>;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  WHATSAPP_SUPPORT_HUB_URL?: string;
  WHATSAPP_SUPPORT_APP_KEY?: string;
  WHATSAPP_SUPPORT_WEBHOOK_SECRET?: string;
  EGOSMS_API_URL?: string;
  EGOSMS_USERNAME?: string;
  EGOSMS_PASSWORD?: string;
  EGOSMS_SENDER_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  BIOMETRIC_ENCRYPTION_KEY?: string;
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

export interface WorkNotificationJob {
  kind: "work-notification";
  deliveryId: string;
  organizationId: string;
  notificationId: string;
  channel: "email" | "sms" | "whatsapp";
  recipient: string;
  subject?: string;
  body: string;
  templateName?: string;
  templateLanguage?: string;
  variables?: string[];
}

export interface CommunicationJob {
  kind: "communication";
  deliveryId: string;
  organizationId: string;
  campaignId: string;
  recipientSnapshotId: string;
  channel: "sms" | "whatsapp";
  recipient: string;
  senderName: string;
  subject: string;
  message: string;
  templateName?: string;
  templateLanguage?: string;
  variables?: string[];
}
