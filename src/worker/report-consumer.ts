import type { Env, ReportJobMessage } from "../types";
import { generateReport, toCsv, toPdf, toXlsx, type ReportFilters } from "../services/reports";

export async function consumeReports(batch: MessageBatch<ReportJobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;
    try {
      const claimed = await env.FINANCE_DB.prepare("UPDATE report_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND status IN ('queued', 'failed')")
        .bind(job.jobId, job.organizationId).run();
      if (!claimed.meta.changes) { message.ack(); continue; }
      const report = await generateReport(env.FINANCE_DB, job.organizationId, job.reportType, job.filters as ReportFilters);
      const objectKey = `${job.organizationId}/${job.jobId}.${job.format}`;
      const body = job.format === "csv" ? toCsv(report) : job.format === "xlsx" ? toXlsx(report) : job.format === "pdf" ? await toPdf(report,await env.FINANCE_DB.prepare("SELECT name,legal_name AS legalName,address_json AS address,tax_registration_number AS taxNumber,branding_json AS branding FROM organizations WHERE id=?").bind(job.organizationId).first<Record<string,unknown>>()) : JSON.stringify(report);
      await env.REPORTS_BUCKET.put(objectKey, body, {
        httpMetadata: { contentType: job.format === "csv" ? "text/csv; charset=utf-8" : job.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : job.format === "pdf" ? "application/pdf" : "application/json" },
        customMetadata: { organizationId: job.organizationId, reportType: job.reportType },
      });
      await env.FINANCE_DB.prepare("UPDATE report_jobs SET status = 'completed', object_key = ?, error = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
        .bind(objectKey, job.jobId, job.organizationId).run();
      message.ack();
    } catch (error) {
      await env.FINANCE_DB.prepare("UPDATE report_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
        .bind(String(error).slice(0, 2000), job.jobId, job.organizationId).run();
      message.retry();
    }
  }
}
