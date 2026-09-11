export const PAYROLL_RELATIONSHIP_CHECKS = Object.freeze([
  ["employees.contact", `SELECT count(*)::bigint AS count FROM employees x LEFT JOIN contacts p ON p.id=x.contact_id WHERE p.id IS NULL`],
  ["payroll_runs.organization", `SELECT count(*)::bigint AS count FROM payroll_runs x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["payroll_lines.run", `SELECT count(*)::bigint AS count FROM payroll_lines x LEFT JOIN payroll_runs p ON p.id=x.payroll_run_id WHERE p.id IS NULL`],
  ["payroll_lines.employee", `SELECT count(*)::bigint AS count FROM payroll_lines x LEFT JOIN employees p ON p.id=x.employee_id WHERE p.id IS NULL`],
  ["payroll_lines.balance", `SELECT count(*)::bigint AS count FROM payroll_lines WHERE paid_minor < 0 OR balance_minor < 0 OR paid_minor > net_minor OR balance_minor <> net_minor-paid_minor`],
  ["payroll_runs.totals", `SELECT count(*)::bigint AS count FROM payroll_runs WHERE gross_minor < 0 OR deductions_minor < 0 OR employer_costs_minor < 0 OR net_minor < 0`],
]);
