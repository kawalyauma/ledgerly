export const FINANCE_OPERATIONS_RELATIONSHIP_CHECKS=Object.freeze([
 {name:'inventory_balance_nonnegative',table:'inventory_balances',sql:`SELECT COUNT(*)::bigint count FROM inventory_balances WHERE quantity_micros<0 OR inventory_value_minor<0`,expected:0},
 {name:'stock_count_tenant',table:'stock_count_lines',sql:`SELECT COUNT(*)::bigint count FROM stock_count_lines l JOIN stock_counts c ON c.id=l.stock_count_id WHERE l.organization_id<>c.organization_id`,expected:0},
 {name:'goods_receipt_tenant',table:'goods_receipt_lines',sql:`SELECT COUNT(*)::bigint count FROM goods_receipt_lines l JOIN goods_receipts r ON r.id=l.goods_receipt_id WHERE l.organization_id<>r.organization_id`,expected:0},
 {name:'bank_match_tenant',table:'bank_transactions',sql:`SELECT COUNT(*)::bigint count FROM bank_transactions b JOIN journal_lines l ON l.id=b.matched_journal_line_id WHERE b.matched_journal_line_id IS NOT NULL AND b.organization_id<>l.organization_id`,expected:0},
 {name:'payment_plan_amounts',table:'payment_plan_installments',sql:`SELECT COUNT(*)::bigint count FROM payment_plan_installments WHERE amount_minor<0 OR paid_minor<0 OR paid_minor>amount_minor`,expected:0},
 {name:'expense_claim_total_nonnegative',table:'expense_claims',sql:`SELECT COUNT(*)::bigint count FROM expense_claims WHERE total_minor<0`,expected:0}
]);
