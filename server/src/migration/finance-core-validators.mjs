export const FINANCE_CORE_RELATIONSHIP_CHECKS = Object.freeze([
  ["contacts.organization", `SELECT count(*)::bigint AS count FROM contacts x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["products.organization", `SELECT count(*)::bigint AS count FROM products x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["journals.organization", `SELECT count(*)::bigint AS count FROM journal_entries x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["journal_lines.journal", `SELECT count(*)::bigint AS count FROM journal_lines x LEFT JOIN journal_entries p ON p.id=x.journal_entry_id WHERE p.id IS NULL`],
  ["journal_lines.account", `SELECT count(*)::bigint AS count FROM journal_lines x LEFT JOIN accounts p ON p.id=x.account_id WHERE p.id IS NULL`],
  ["documents.contact", `SELECT count(*)::bigint AS count FROM documents x LEFT JOIN contacts p ON p.id=x.contact_id WHERE x.contact_id IS NOT NULL AND p.id IS NULL`],
  ["document_lines.document", `SELECT count(*)::bigint AS count FROM document_lines x LEFT JOIN documents p ON p.id=x.document_id WHERE p.id IS NULL`],
  ["payments.contact", `SELECT count(*)::bigint AS count FROM payments x LEFT JOIN contacts p ON p.id=x.contact_id WHERE p.id IS NULL`],
  ["payment_allocations.payment", `SELECT count(*)::bigint AS count FROM payment_allocations x LEFT JOIN payments p ON p.id=x.payment_id WHERE p.id IS NULL`],
  ["payment_allocations.document", `SELECT count(*)::bigint AS count FROM payment_allocations x LEFT JOIN documents p ON p.id=x.document_id WHERE p.id IS NULL`],
  ["posted_journals.balance", `SELECT count(*)::bigint AS count FROM (SELECT j.id FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id WHERE j.status IN ('posted','reversed') GROUP BY j.id HAVING COALESCE(sum(l.debit_minor),0) <> COALESCE(sum(l.credit_minor),0)) x`],
  ["documents.paid_limit", `SELECT count(*)::bigint AS count FROM documents WHERE paid_minor < 0 OR paid_minor > total_minor`],
]);
