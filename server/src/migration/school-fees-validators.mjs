export const SCHOOL_FEES_RELATIONSHIP_CHECKS = Object.freeze([
  ["fee_structures.organization", `SELECT count(*)::bigint AS count FROM school_fee_structures x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["fee_structure_lines.structure", `SELECT count(*)::bigint AS count FROM school_fee_structure_lines x LEFT JOIN school_fee_structures p ON p.id=x.structure_id WHERE p.id IS NULL`],
  ["fee_charges.contact", `SELECT count(*)::bigint AS count FROM school_student_fee_charges x LEFT JOIN contacts p ON p.id=x.payer_contact_id WHERE p.id IS NULL`],
  ["fee_charges.document", `SELECT count(*)::bigint AS count FROM school_student_fee_charges x LEFT JOIN documents p ON p.id=x.document_id WHERE x.document_id IS NOT NULL AND p.id IS NULL`],
  ["fee_receipts.payment", `SELECT count(*)::bigint AS count FROM school_fee_receipts x LEFT JOIN payments p ON p.id=x.payment_id WHERE p.id IS NULL`],
  ["fee_receipts.contact", `SELECT count(*)::bigint AS count FROM school_fee_receipts x LEFT JOIN contacts p ON p.id=x.payer_contact_id WHERE p.id IS NULL`],
  ["fee_receipt_snapshots.receipt", `SELECT count(*)::bigint AS count FROM school_fee_receipt_snapshots x LEFT JOIN school_fee_receipts p ON p.id=x.receipt_id WHERE p.id IS NULL`],
  ["fee_receipts.amounts", `SELECT count(*)::bigint AS count FROM school_fee_receipts WHERE amount_minor <= 0 OR allocated_minor < 0 OR unallocated_minor < 0 OR allocated_minor + unallocated_minor <> amount_minor`],
  ["fee_charges.amounts", `SELECT count(*)::bigint AS count FROM school_student_fee_charges WHERE total_minor < 0 OR credited_minor < 0 OR written_off_minor < 0`],
]);
