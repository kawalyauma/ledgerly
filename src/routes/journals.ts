import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { AppError } from "../lib/errors";
import { pagination } from "../lib/http";
import { requireScope } from "../lib/auth";
import { createJournal, postJournal } from "../services/ledger";
import { auditStatement } from "../services/audit";
import { previewCrossModuleReversal, reverseCrossModuleJournal } from "../services/crossModuleReversal";

const lineInput = z.object({
  accountId: z.string().min(1), description: z.string().max(500).optional(), debitMinor: z.number().int().nonnegative().optional(),
  creditMinor: z.number().int().nonnegative().optional(), contactId: z.string().optional(), projectId: z.string().optional(),
  classId: z.string().optional(), departmentId: z.string().optional(), locationId: z.string().optional(), taxCode: z.string().max(30).optional(),
});
const journalInput = z.object({
  transactionDate: z.iso.date(), postingDate: z.iso.date(), description: z.string().min(1).max(500), reference: z.string().max(100).optional(),
  currency: z.string().length(3).toUpperCase(), exchangeRateMicros: z.number().int().positive().optional(), sourceType: z.string().max(50).optional(),
  sourceId: z.string().max(100).optional(), lines: z.array(lineInput).min(2).max(500),
});
const reversalInput = z.object({ postingDate: z.iso.date(), reason: z.string().trim().min(3).max(500) });

export const journalsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

journalsRoutes.get("/", requireScope("journals:read"), async (c) => {
  const p = c.get("principal");
  const { limit, offset } = pagination(c);
  const result = await c.env.FINANCE_DB.prepare(`SELECT id, entry_number AS entryNumber, transaction_date AS transactionDate,
    posting_date AS postingDate, description, reference, source_type AS sourceType, status, currency, posted_at AS postedAt, created_at AS createdAt
    FROM journal_entries WHERE organization_id = ? ORDER BY posting_date DESC, entry_number DESC LIMIT ? OFFSET ?`)
    .bind(p.organizationId, limit, offset).all();
  return c.json({ data: result.results, pagination: { limit, offset } });
});

journalsRoutes.get("/:id", requireScope("journals:read"), async (c) => {
  const p = c.get("principal");
  const entry = await c.env.FINANCE_DB.prepare("SELECT * FROM journal_entries WHERE id = ? AND organization_id = ?").bind(c.req.param("id"), p.organizationId).first();
  if (!entry) throw new AppError(404, "NOT_FOUND", "Journal not found");
  const lines = await c.env.FINANCE_DB.prepare(`SELECT l.*, a.code AS account_code, a.name AS account_name,
      ct.name AS contact_name, pr.name AS project_name, pr.code AS project_code,
      cls.name AS class_name, dept.name AS department_name, loc.name AS location_name
    FROM journal_lines l
    JOIN accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
    LEFT JOIN contacts ct ON ct.id=l.contact_id AND ct.organization_id=l.organization_id
    LEFT JOIN projects pr ON pr.id=l.project_id AND pr.organization_id=l.organization_id
    LEFT JOIN dimensions cls ON cls.id=l.class_id AND cls.organization_id=l.organization_id
    LEFT JOIN dimensions dept ON dept.id=l.department_id AND dept.organization_id=l.organization_id
    LEFT JOIN dimensions loc ON loc.id=l.location_id AND loc.organization_id=l.organization_id
    WHERE l.journal_entry_id = ? AND l.organization_id = ? ORDER BY l.id`)
    .bind(c.req.param("id"), p.organizationId).all<Record<string, any>>();
  const enriched=[];
  for(const row of lines.results){
    let dimensions:Record<string,unknown>={};try{dimensions=JSON.parse(String(row.dimensions_json||"{}"))}catch{dimensions={}}
    const labels:string[]=[];
    if(row.contact_name)labels.push(`Contact: ${row.contact_name}`);
    if(row.project_name)labels.push(`Project: ${row.project_code?`${row.project_code} · `:""}${row.project_name}`);
    if(row.class_name)labels.push(`Class: ${row.class_name}`);
    if(row.department_name)labels.push(`Department: ${row.department_name}`);
    if(row.location_name)labels.push(`Location: ${row.location_name}`);
    const schoolLookups:[string[],string,string][]=[
      [["schoolStudentId","studentId"],"school_students","student"], [["schoolAcademicYearId","academicYearId"],"school_academic_years","Academic year"],
      [["schoolTermId","termId"],"school_terms","Term"], [["schoolCampusId","campusId"],"school_branches","Campus"],
      [["schoolClassId","classId"],"school_classes","School class"], [["schoolStreamId","streamId"],"school_streams","Stream"],
      [["schoolFeeCategoryId","feeCategoryId"],"school_fee_categories","Fee category"]
    ];
    for(const [keys,table,label] of schoolLookups){const value=keys.map(key=>dimensions[key]).find(v=>typeof v==="string"&&Boolean(v));if(typeof value!=="string"||!value)continue;
      if(table==="school_students"){const found=await c.env.FINANCE_DB.prepare("SELECT admission_number AS code,TRIM(first_name || ' ' || COALESCE(middle_name || ' ','') || last_name) AS name FROM school_students WHERE id=? AND organization_id=?").bind(value,p.organizationId).first<{code:string;name:string}>();if(found)labels.push(`Student: ${found.name} (${found.code})`)}
      else {const found=await c.env.FINANCE_DB.prepare(`SELECT ${table==="school_branches"?"code,":""} name FROM ${table} WHERE id=? AND organization_id=?`).bind(value,p.organizationId).first<{code?:string;name:string}>();if(found)labels.push(`${label}: ${found.code?`${found.code} · `:""}${found.name}`)}
    }
    if(row.tax_code)labels.push(`Tax: ${row.tax_code}`);
    enriched.push({...row,dimensions,dimension_labels:labels});
  }
  return c.json({ data: { ...entry, lines: enriched } });
});

journalsRoutes.post("/", requireScope("journals:write"), async (c) => {
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length > 200) throw new AppError(422, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  const parsed = journalInput.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid journal", parsed.error.flatten());
  const p = c.get("principal");
  const journal = await createJournal(c.env.FINANCE_DB, p.organizationId, p.userId, parsed.data, idempotencyKey);
  return c.json({ data: journal }, 201);
});

journalsRoutes.post("/:id/post", requireScope("journals:write"), async (c) => {
  const p = c.get("principal");
  await postJournal(c.env.FINANCE_DB, p.organizationId, p.userId, c.req.param("id"));
  return c.json({ data: { id: c.req.param("id"), status: "posted" } });
});

journalsRoutes.get("/:id/reversal-preview", requireScope("journals:read"), async (c) => {
  const p = c.get("principal");
  return c.json({ data: await previewCrossModuleReversal(c.env.FINANCE_DB, p.organizationId, c.req.param("id")) });
});

journalsRoutes.post("/:id/reverse", requireScope("journals:write"), async (c) => {
  const parsed = reversalInput.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "A posting date and reason are required", parsed.error.flatten());
  const p = c.get("principal"), journalId = c.req.param("id");
  const result = await reverseCrossModuleJournal(c.env.FINANCE_DB, p.organizationId, p.userId, journalId, parsed.data.postingDate, parsed.data.reason);
  return c.json({ data: result });
});

journalsRoutes.delete("/:id", requireScope("journals:write"), async (c) => {
  const p = c.get("principal"); const id = c.req.param("id");
  const journal = await c.env.FINANCE_DB.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<{status:string}>();
  if (!journal) throw new AppError(404,"NOT_FOUND","Journal not found");
  if (journal.status !== "draft") throw new AppError(409,"IMMUTABLE_POSTED_TRANSACTION","Posted journals must be reversed, not deleted");
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare("DELETE FROM journal_lines WHERE journal_entry_id=? AND organization_id=?").bind(id,p.organizationId),
    c.env.FINANCE_DB.prepare("DELETE FROM journal_entries WHERE id=? AND organization_id=? AND status='draft'").bind(id,p.organizationId),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"journal.draft_deleted",entityType:"journal_entry",entityId:id}),
  ]);
  return c.body(null,204);
});
