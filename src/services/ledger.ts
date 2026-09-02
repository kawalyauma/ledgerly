import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { auditStatement } from "./audit";
import { assertPostingDateOpen } from "./periods";

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debitMinor?: number;
  creditMinor?: number;
  contactId?: string;
  projectId?: string;
  classId?: string;
  departmentId?: string;
  locationId?: string;
  taxCode?: string;
}

export interface CreateJournalInput {
  transactionDate: string;
  postingDate: string;
  description: string;
  reference?: string;
  currency: string;
  exchangeRateMicros?: number;
  sourceType?: string;
  sourceId?: string;
  lines: JournalLineInput[];
}

function validate(input: CreateJournalInput): void {
  if (input.lines.length < 2) throw new AppError(422, "INVALID_JOURNAL", "A journal requires at least two lines");
  let debit = 0;
  let credit = 0;
  for (const line of input.lines) {
    const dr = line.debitMinor ?? 0;
    const cr = line.creditMinor ?? 0;
    if (!Number.isSafeInteger(dr) || !Number.isSafeInteger(cr) || dr < 0 || cr < 0 || (dr > 0) === (cr > 0)) {
      throw new AppError(422, "INVALID_JOURNAL_LINE", "Each line needs exactly one positive debit or credit in minor currency units");
    }
    debit += dr;
    credit += cr;
  }
  if (debit !== credit) throw new AppError(422, "UNBALANCED_JOURNAL", "Total debits must equal total credits", { debitMinor: debit, creditMinor: credit });
}

export async function createJournal(db: D1Database, organizationId: string, actorId: string, input: CreateJournalInput, idempotencyKey: string): Promise<{ id: string; entryNumber: string; status: "draft" }> {
  validate(input);
  const existing = await db.prepare("SELECT id, entry_number AS entryNumber, status FROM journal_entries WHERE organization_id = ? AND idempotency_key = ?")
    .bind(organizationId, idempotencyKey).first<{ id: string; entryNumber: string; status: "draft" }>();
  if (existing) return existing;

  const badAccount = await db.prepare(`SELECT a.id FROM accounts a
    WHERE a.organization_id = ? AND a.id IN (${input.lines.map(() => "?").join(",")}) AND (a.active = 0 OR a.allow_posting = 0)`)
    .bind(organizationId, ...input.lines.map((line) => line.accountId)).first();
  if (badAccount) throw new AppError(422, "ACCOUNT_NOT_POSTABLE", "A journal line references an inactive or non-posting account");
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM accounts WHERE organization_id = ? AND id IN (${input.lines.map(() => "?").join(",")})`)
    .bind(organizationId, ...input.lines.map((line) => line.accountId)).first<{ count: number }>();
  if (Number(count?.count ?? 0) !== new Set(input.lines.map((line) => line.accountId)).size) {
    throw new AppError(422, "INVALID_ACCOUNT", "Every account must belong to the organization");
  }

  const id = createId("jnl");
  const sequence = await db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(entry_number, 4) AS INTEGER)), 0) + 1 AS next FROM journal_entries WHERE organization_id = ?")
    .bind(organizationId).first<{ next: number }>();
  const entryNumber = `JE-${String(sequence?.next ?? 1).padStart(8, "0")}`;
  const rate = input.exchangeRateMicros ?? 1_000_000;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO journal_entries
      (id, organization_id, entry_number, transaction_date, posting_date, description, reference, source_type, source_id, status, currency, exchange_rate_micros, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .bind(id, organizationId, entryNumber, input.transactionDate, input.postingDate, input.description, input.reference ?? null,
        input.sourceType ?? "manual", input.sourceId ?? null, input.currency, rate, idempotencyKey),
  ];
  for (const line of input.lines) {
    const debit = line.debitMinor ?? 0;
    const credit = line.creditMinor ?? 0;
    statements.push(db.prepare(`INSERT INTO journal_lines
      (id, organization_id, journal_entry_id, account_id, description, debit_minor, credit_minor, base_debit_minor, base_credit_minor, contact_id, project_id, class_id, department_id, location_id, tax_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(createId("jln"), organizationId, id, line.accountId, line.description ?? null, debit, credit,
        Math.round(debit * rate / 1_000_000), Math.round(credit * rate / 1_000_000), line.contactId ?? null,
        line.projectId ?? null, line.classId ?? null, line.departmentId ?? null, line.locationId ?? null, line.taxCode ?? null));
  }
  statements.push(auditStatement(db, { organizationId, actorId, action: "journal.created", entityType: "journal_entry", entityId: id, after: { entryNumber } }));
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      const retry = await db.prepare("SELECT id, entry_number AS entryNumber, status FROM journal_entries WHERE organization_id = ? AND idempotency_key = ?")
        .bind(organizationId, idempotencyKey).first<{ id: string; entryNumber: string; status: "draft" }>();
      if (retry) return retry;
    }
    throw error;
  }
  return { id, entryNumber, status: "draft" };
}

export async function postJournal(db: D1Database, organizationId: string, actorId: string, id: string): Promise<void> {
  const journal = await db.prepare("SELECT status, posting_date AS postingDate FROM journal_entries WHERE id = ? AND organization_id = ?").bind(id, organizationId).first<{ status: string; postingDate: string }>();
  if (!journal) throw new AppError(404, "NOT_FOUND", "Journal not found");
  if (journal.status !== "draft") throw new AppError(409, "INVALID_STATE", "Only draft journals can be posted");
  await assertPostingDateOpen(db, organizationId, journal.postingDate);
  const totals = await db.prepare("SELECT SUM(debit_minor) AS debit, SUM(credit_minor) AS credit FROM journal_lines WHERE organization_id = ? AND journal_entry_id = ?")
    .bind(organizationId, id).first<{ debit: number; credit: number }>();
  if (!totals || totals.debit !== totals.credit || totals.debit <= 0) throw new AppError(422, "UNBALANCED_JOURNAL", "Journal is not balanced");
  await db.batch([
    db.prepare("UPDATE journal_entries SET status = 'posted', posted_at = CURRENT_TIMESTAMP, posted_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ? AND status = 'draft'").bind(actorId, id, organizationId),
    auditStatement(db, { organizationId, actorId, action: "journal.posted", entityType: "journal_entry", entityId: id }),
  ]);
}

export async function reverseJournal(db: D1Database, organizationId: string, actorId: string, id: string, postingDate: string, reason: string): Promise<{ id: string; entryNumber: string }> {
  const original = await db.prepare(`SELECT id,entry_number AS entryNumber,transaction_date AS transactionDate,description,currency,
    exchange_rate_micros AS exchangeRateMicros,status FROM journal_entries WHERE id=? AND organization_id=?`)
    .bind(id, organizationId).first<{ id: string; entryNumber: string; transactionDate: string; description: string; currency: string; exchangeRateMicros: number; status: string }>();
  if (!original) throw new AppError(404, "NOT_FOUND", "Journal not found");
  if (original.status !== "posted") throw new AppError(409, "INVALID_STATE", "Only an unreversed posted journal can be reversed");
  await assertPostingDateOpen(db, organizationId, postingDate);
  const raw = await db.prepare(`SELECT account_id AS accountId,description,debit_minor AS debitMinor,credit_minor AS creditMinor,
    contact_id AS contactId,project_id AS projectId,class_id AS classId,department_id AS departmentId,location_id AS locationId,tax_code AS taxCode
    FROM journal_lines WHERE journal_entry_id=? AND organization_id=? ORDER BY id`).bind(id, organizationId).all<JournalLineInput>();
  const reversal = await createJournal(db, organizationId, actorId, {
    transactionDate: postingDate, postingDate, description: `Reversal of ${original.entryNumber}: ${reason}`, reference: original.entryNumber,
    currency: original.currency, exchangeRateMicros: original.exchangeRateMicros, sourceType: "reversal", sourceId: id,
    lines: raw.results.map((line) => ({ ...line, debitMinor: line.creditMinor ?? 0, creditMinor: line.debitMinor ?? 0 })),
  }, `journal:${id}:reversal`);
  await db.prepare("UPDATE journal_entries SET reversal_of_id=? WHERE id=? AND organization_id=? AND status='draft'").bind(id, reversal.id, organizationId).run();
  const state = await db.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(reversal.id, organizationId).first<{ status: string }>();
  if (state?.status === "draft") await postJournal(db, organizationId, actorId, reversal.id);
  const result = await db.batch([
    db.prepare("UPDATE journal_entries SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='posted'").bind(id, organizationId),
    auditStatement(db, { organizationId, actorId, action: "journal.reversed", entityType: "journal_entry", entityId: id, after: { reversalId: reversal.id, reason } }),
  ]);
  if (!result[0]?.meta.changes) throw new AppError(409, "ALREADY_REVERSED", "Journal was reversed by another request");
  return { id: reversal.id, entryNumber: reversal.entryNumber };
}
