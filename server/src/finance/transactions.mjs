function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

function toMinor(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

export class FinanceIntegrityError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "FinanceIntegrityError";
    this.code = code;
    this.details = details;
  }
}

export class FinanceTransactions {
  constructor({ database, sourceReversalHandlers = new Map() }) {
    if (!database || typeof database.transaction !== "function") throw new TypeError("database.transaction is required");
    this.database = database;
    this.sourceReversalHandlers = sourceReversalHandlers;
  }

  async postJournal({ organizationId, journalId, actorId }) {
    requireText(organizationId,"organizationId");
    requireText(journalId,"journalId");
    requireText(actorId,"actorId");
    return this.database.transaction(async (tx) => {
      const journalResult = await tx.query(
        `SELECT id,status FROM journal_entries WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [journalId,organizationId],
      );
      const journal = journalResult.rows[0];
      if (!journal) throw new FinanceIntegrityError("JOURNAL_NOT_FOUND","Journal not found");
      if (journal.status === "posted") return { id:journalId,status:"posted",alreadyPosted:true };
      if (journal.status !== "draft") throw new FinanceIntegrityError("INVALID_JOURNAL_STATE","Only draft journals can be posted");

      const totalsResult = await tx.query(
        `SELECT COUNT(*)::int AS line_count,
                COALESCE(SUM(debit_minor),0)::bigint AS debit_minor,
                COALESCE(SUM(credit_minor),0)::bigint AS credit_minor
           FROM journal_lines
          WHERE journal_entry_id=$1 AND organization_id=$2`,
        [journalId,organizationId],
      );
      const totals = totalsResult.rows[0] ?? {};
      const debitMinor = BigInt(totals.debit_minor ?? 0);
      const creditMinor = BigInt(totals.credit_minor ?? 0);
      if (Number(totals.line_count ?? 0) < 2 || debitMinor <= 0n || debitMinor !== creditMinor) {
        throw new FinanceIntegrityError("UNBALANCED_JOURNAL","Journal must contain at least two balanced non-zero lines");
      }

      const updated = await tx.query(
        `UPDATE journal_entries
            SET status='posted',posted_at=now(),posted_by=$3,updated_at=now()
          WHERE id=$1 AND organization_id=$2 AND status='draft'
          RETURNING id,status,posted_at`,
        [journalId,organizationId,actorId],
      );
      if (updated.rowCount !== 1) throw new FinanceIntegrityError("CONCURRENT_JOURNAL_CHANGE","Journal changed while posting");
      return updated.rows[0];
    });
  }

  async allocatePayment({ organizationId, allocationId, paymentId, documentId, amountMinor }) {
    requireText(organizationId,"organizationId");
    requireText(allocationId,"allocationId");
    requireText(paymentId,"paymentId");
    requireText(documentId,"documentId");
    const amount = toMinor(amountMinor,"amountMinor");
    if (amount <= 0) throw new FinanceIntegrityError("INVALID_ALLOCATION","Allocation amount must be positive");

    return this.database.transaction(async (tx) => {
      const existing = await tx.query(
        `SELECT id,payment_id,document_id,amount_minor
           FROM payment_allocations
          WHERE id=$1 AND organization_id=$2`,
        [allocationId,organizationId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.payment_id !== paymentId || row.document_id !== documentId || Number(row.amount_minor) !== amount) {
          throw new FinanceIntegrityError("IDEMPOTENCY_CONFLICT","Allocation id already exists with different values");
        }
        return { ...row,alreadyApplied:true };
      }

      const paymentResult = await tx.query(
        `SELECT id,type,contact_id,currency,amount_minor,status
           FROM payments WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [paymentId,organizationId],
      );
      const documentResult = await tx.query(
        `SELECT id,type,contact_id,currency,total_minor,paid_minor,status
           FROM documents WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [documentId,organizationId],
      );
      const payment = paymentResult.rows[0], document = documentResult.rows[0];
      if (!payment || !document) throw new FinanceIntegrityError("ALLOCATION_TARGET_NOT_FOUND","Payment or document not found");
      if (payment.status !== "posted") throw new FinanceIntegrityError("PAYMENT_NOT_POSTED","Only posted payments can be allocated");
      if (!["open","partially_paid"].includes(document.status)) throw new FinanceIntegrityError("DOCUMENT_NOT_OPEN","Document is not open for allocation");
      const expectedDocumentType = payment.type === "receipt" ? "invoice" : payment.type === "payment" ? "bill" : null;
      if (!expectedDocumentType || document.type !== expectedDocumentType ||
          payment.contact_id !== document.contact_id || payment.currency !== document.currency) {
        throw new FinanceIntegrityError("ALLOCATION_MISMATCH","Document does not match payment");
      }

      const allocatedResult = await tx.query(
        `SELECT COALESCE(SUM(amount_minor),0)::bigint AS allocated_minor
           FROM payment_allocations WHERE payment_id=$1 AND organization_id=$2`,
        [paymentId,organizationId],
      );
      const allocated = BigInt(allocatedResult.rows[0]?.allocated_minor ?? 0);
      const paymentAmount = BigInt(payment.amount_minor);
      const documentBalance = BigInt(document.total_minor) - BigInt(document.paid_minor);
      const requested = BigInt(amount);
      if (allocated + requested > paymentAmount) throw new FinanceIntegrityError("PAYMENT_OVERALLOCATED","Allocations exceed payment amount");
      if (requested > documentBalance) throw new FinanceIntegrityError("DOCUMENT_OVERALLOCATED","Allocation exceeds document balance");

      await tx.query(
        `INSERT INTO payment_allocations
           (id,organization_id,payment_id,document_id,amount_minor,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,now(),now())`,
        [allocationId,organizationId,paymentId,documentId,amount],
      );
      const updated = await tx.query(
        `UPDATE documents
            SET paid_minor=paid_minor+$3,
                status=CASE WHEN paid_minor+$3=total_minor THEN 'paid' ELSE 'partially_paid' END,
                updated_at=now()
          WHERE id=$1 AND organization_id=$2
          RETURNING id,paid_minor,total_minor,status`,
        [documentId,organizationId,amount],
      );
      return { id:allocationId,paymentId,documentId,amountMinor:amount,document:updated.rows[0] };
    });
  }

  async reverseJournal({ organizationId, journalId, actorId, postingDate, reason, reversalId, reversalNumber }) {
    requireText(organizationId,"organizationId");
    requireText(journalId,"journalId");
    requireText(actorId,"actorId");
    requireText(postingDate,"postingDate");
    requireText(reason,"reason");
    requireText(reversalId,"reversalId");
    requireText(reversalNumber,"reversalNumber");

    return this.database.transaction(async (tx) => {
      const originalResult = await tx.query(
        `SELECT * FROM journal_entries WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [journalId,organizationId],
      );
      const original = originalResult.rows[0];
      if (!original) throw new FinanceIntegrityError("JOURNAL_NOT_FOUND","Journal not found");
      if (original.status === "reversed") {
        const existing = await tx.query(
          `SELECT * FROM journal_entries WHERE reversal_of_id=$1 AND organization_id=$2 ORDER BY created_at LIMIT 1`,
          [journalId,organizationId],
        );
        return { originalId:journalId,status:"reversed",reversal:existing.rows[0] ?? null,alreadyReversed:true };
      }
      if (original.status !== "posted") throw new FinanceIntegrityError("INVALID_JOURNAL_STATE","Only posted journals can be reversed");

      const lines = await tx.query(
        `SELECT * FROM journal_lines WHERE journal_entry_id=$1 AND organization_id=$2 ORDER BY id FOR UPDATE`,
        [journalId,organizationId],
      );
      if (lines.rows.length < 2) throw new FinanceIntegrityError("INVALID_JOURNAL","Posted journal has insufficient lines");

      const handler = this.sourceReversalHandlers.get(original.source_type);
      if (handler) {
        await handler({ tx,organizationId,actorId,original,postingDate,reason });
      }

      await tx.query(
        `INSERT INTO journal_entries
          (id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,exchange_rate_micros,reversal_of_id,posted_at,posted_by,idempotency_key,metadata,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$4,$5,$6,'reversal',$7,'posted',$8,$9,$7,now(),$10,$11,$12,now(),now())`,
        [reversalId,organizationId,reversalNumber,postingDate,`Reversal: ${original.description}`,reason,journalId,original.currency,original.exchange_rate_micros,actorId,`reversal:${journalId}`,original.metadata ?? "{}"],
      );
      for (const line of lines.rows) {
        await tx.query(
          `INSERT INTO journal_lines
            (id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,project_id,class_id,department_id,location_id,tax_code,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())`,
          [`${reversalId}:${line.id}`,organizationId,reversalId,line.account_id,line.description,
           line.credit_minor,line.debit_minor,line.base_credit_minor,line.base_debit_minor,
           line.contact_id,line.project_id,line.class_id,line.department_id,line.location_id,line.tax_code],
        );
      }
      const mark = await tx.query(
        `UPDATE journal_entries SET status='reversed',updated_at=now()
          WHERE id=$1 AND organization_id=$2 AND status='posted' RETURNING id`,
        [journalId,organizationId],
      );
      if (mark.rowCount !== 1) throw new FinanceIntegrityError("CONCURRENT_JOURNAL_CHANGE","Journal changed while reversing");
      return { originalId:journalId,status:"reversed",reversal:{ id:reversalId,reversalOfId:journalId } };
    });
  }
}

export function schoolFeeReversalHandler() {
  return async ({ tx,organizationId,original,reason }) => {
    const payment = await tx.query(
      `SELECT id,status FROM school_fee_payments
        WHERE organization_id=$1 AND journal_entry_id=$2 FOR UPDATE`,
      [organizationId,original.id],
    );
    if (!payment.rows[0]) {
      throw new FinanceIntegrityError("SOURCE_LINK_MISSING","School fee journal has no originating payment");
    }
    if (payment.rows[0].status === "reversed") return;
    const changed = await tx.query(
      `UPDATE school_fee_payments
          SET status='reversed',reversal_reason=$3,reversed_at=now(),updated_at=now()
        WHERE id=$1 AND organization_id=$2 AND status='posted'
        RETURNING id`,
      [payment.rows[0].id,organizationId,reason],
    );
    if (changed.rowCount !== 1) throw new FinanceIntegrityError("SCHOOL_FEE_REVERSAL_CONFLICT","School fee payment changed while reversing");
    await tx.query(
      `UPDATE school_fee_payment_allocations
          SET status='reversed',updated_at=now()
        WHERE organization_id=$1 AND payment_id=$2 AND status='posted'`,
      [organizationId,payment.rows[0].id],
    );
  };
}
