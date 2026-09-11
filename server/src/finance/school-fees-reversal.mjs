import { FinanceIntegrityError } from './transactions.mjs';

export function schoolFeeReceiptReversalHandler() {
  return async ({ tx,organizationId,original,reason }) => {
    const receiptResult = await tx.query(
      `SELECT r.id AS receipt_id,r.status AS receipt_status,p.id AS payment_id,p.status AS payment_status
         FROM school_fee_receipts r
         JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id
        WHERE r.organization_id=$1 AND p.journal_entry_id=$2
        FOR UPDATE OF r,p`,
      [organizationId,original.id],
    );
    const receipt=receiptResult.rows[0];
    if (!receipt) return { handled:false };
    if (receipt.receipt_status === 'reversed' && receipt.payment_status === 'reversed') return { handled:true,alreadyReversed:true };
    if (receipt.receipt_status !== 'posted' || receipt.payment_status !== 'posted') {
      throw new FinanceIntegrityError('SCHOOL_FEE_REVERSAL_CONFLICT','School fee receipt/payment is not posted');
    }

    const allocations = await tx.query(
      `SELECT id,document_id,amount_minor
         FROM payment_allocations
        WHERE organization_id=$1 AND payment_id=$2 AND reversed_at IS NULL
        ORDER BY id FOR UPDATE`,
      [organizationId,receipt.payment_id],
    );
    for (const allocation of allocations.rows) {
      const document = await tx.query(
        `UPDATE documents
            SET paid_minor=paid_minor-$3,
                status=CASE WHEN paid_minor-$3=0 THEN 'open' ELSE 'partially_paid' END,
                updated_at=now()
          WHERE id=$1 AND organization_id=$2 AND paid_minor >= $3
          RETURNING id,paid_minor,status`,
        [allocation.document_id,organizationId,allocation.amount_minor],
      );
      if (document.rowCount !== 1) throw new FinanceIntegrityError('DOCUMENT_REVERSAL_CONFLICT','Document balance changed while reversing receipt');
      await tx.query(
        `UPDATE payment_allocations SET reversed_at=now(),updated_at=now()
          WHERE id=$1 AND organization_id=$2 AND reversed_at IS NULL`,
        [allocation.id,organizationId],
      );
      await tx.query(
        `UPDATE school_student_fee_charges
            SET status=CASE WHEN $3::bigint=0 THEN 'invoiced' ELSE 'partially_settled' END,updated_at=now()
          WHERE organization_id=$1 AND document_id=$2
            AND status IN ('invoiced','partially_settled','settled')`,
        [organizationId,allocation.document_id,document.rows[0].paid_minor],
      );
    }

    const payment = await tx.query(
      `UPDATE payments SET status='reversed',updated_at=now()
        WHERE id=$1 AND organization_id=$2 AND status='posted' RETURNING id`,
      [receipt.payment_id,organizationId],
    );
    const feeReceipt = await tx.query(
      `UPDATE school_fee_receipts
          SET status='reversed',reversed_at=now(),notes=CASE WHEN notes IS NULL OR notes='' THEN $3 ELSE notes || E'\\nReversal: ' || $3 END,updated_at=now()
        WHERE id=$1 AND organization_id=$2 AND status='posted' RETURNING id`,
      [receipt.receipt_id,organizationId,reason],
    );
    if (payment.rowCount !== 1 || feeReceipt.rowCount !== 1) {
      throw new FinanceIntegrityError('SCHOOL_FEE_REVERSAL_CONFLICT','Receipt changed while reversing');
    }
    return { handled:true,receiptId:receipt.receipt_id,paymentId:receipt.payment_id };
  };
}
