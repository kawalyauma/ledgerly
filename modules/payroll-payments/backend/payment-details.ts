import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";

export const paymentsDetailRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
paymentsDetailRoutes.use("*",requireModuleEnabled("payroll-payments"));
paymentsDetailRoutes.get("/:id/details",requireScope("payments:read"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const payment=await c.env.FINANCE_DB.prepare(`SELECT p.id,p.type,p.number,p.contact_id AS contactId,c.name AS contact,p.bank_account_id AS bankAccountId,p.control_account_id AS controlAccountId,p.payment_date AS paymentDate,p.currency,p.amount_minor AS amountMinor,p.reference,p.status,p.journal_entry_id AS journalEntryId FROM payments p JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id WHERE p.id=? AND p.organization_id=?`).bind(id,p.organizationId).first<any>();
  if(!payment)throw new AppError(404,"NOT_FOUND","Payment not found");
  const allocations=await c.env.FINANCE_DB.prepare(`SELECT a.id,a.document_id AS documentId,d.number AS documentNumber,a.amount_minor AS amountMinor,a.reversed_at AS reversedAt FROM payment_allocations a JOIN documents d ON d.id=a.document_id AND d.organization_id=a.organization_id WHERE a.payment_id=? AND a.organization_id=? ORDER BY a.created_at,a.id`).bind(id,p.organizationId).all();
  const allocated=allocations.results.filter((x:any)=>!x.reversedAt).reduce((n:number,x:any)=>n+Number(x.amountMinor||0),0);
  return c.json({data:{...payment,allocations:allocations.results,allocatedMinor:allocated,unallocatedMinor:Math.max(0,Number(payment.amountMinor)-allocated)}});
});
