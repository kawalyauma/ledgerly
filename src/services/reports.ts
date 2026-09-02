import { AppError } from "../lib/errors";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const reportTypes = [
  "profit-loss", "balance-sheet", "cash-flow", "trial-balance", "general-ledger", "transaction-detail",
  "receivables-ageing", "payables-ageing", "sales-analysis", "expense-analysis", "inventory-valuation",
  "project-profitability", "budget-vs-actual", "tax-summary", "payroll-summary",
  "changes-in-equity", "retained-earnings", "customer-statement", "supplier-statement", "bank-reconciliation",
  "fixed-asset-register", "depreciation", "detailed-tax-return", "consolidated-statements", "comparative-statements",
] as const;

export type ReportType = typeof reportTypes[number];
export interface ReportFilters { from?: string; to?: string; asOf?: string; accountId?: string; contactId?: string; projectId?: string }
export interface ReportResult { reportType: ReportType; generatedAt: string; filters: ReportFilters; columns: string[]; rows: Record<string, unknown>[]; totals?: Record<string, number> }

function whereDimensions(filters: ReportFilters, alias = "l"): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of [["accountId", "account_id"], ["contactId", "contact_id"], ["projectId", "project_id"]] as const) {
    if (filters[key]) { clauses.push(`${alias}.${column} = ?`); values.push(filters[key]); }
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

async function ledgerSummary(db: D1Database, org: string, filters: ReportFilters, types?: string[]): Promise<Record<string, unknown>[]> {
  const from = filters.from ?? "0001-01-01";
  const to = filters.to ?? filters.asOf ?? "9999-12-31";
  const dim = whereDimensions(filters);
  const typeClause = types?.length ? ` AND a.type IN (${types.map(() => "?").join(",")})` : "";
  const result = await db.prepare(`SELECT a.id AS accountId, a.code, a.name, a.type, a.subtype,
      SUM(l.base_debit_minor) AS debitMinor, SUM(l.base_credit_minor) AS creditMinor,
      SUM(l.base_debit_minor - l.base_credit_minor) AS netDebitMinor
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_entry_id AND j.organization_id = l.organization_id
    JOIN accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
    WHERE l.organization_id = ? AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN ? AND ?${typeClause}${dim.sql}
    GROUP BY a.id, a.code, a.name, a.type, a.subtype ORDER BY a.code`)
    .bind(org, from, to, ...(types ?? []), ...dim.values).all<Record<string, unknown>>();
  return result.results;
}

export async function generateReport(db: D1Database, organizationId: string, reportType: string, filters: ReportFilters): Promise<ReportResult> {
  if (!reportTypes.includes(reportType as ReportType)) throw new AppError(404, "UNKNOWN_REPORT", "Unknown report type");
  const type = reportType as ReportType;
  const now = new Date().toISOString();
  let rows: Record<string, unknown>[] = [];
  let columns: string[] = [];
  let totals: Record<string, number> | undefined;

  if (type === "profit-loss") {
    rows = await ledgerSummary(db, organizationId, filters, ["revenue", "expense"]);
    rows = rows.map((r) => ({ ...r, amountMinor: r.type === "revenue" ? Number(r.creditMinor) - Number(r.debitMinor) : Number(r.debitMinor) - Number(r.creditMinor) }));
    const revenueMinor = rows.filter((r) => r.type === "revenue").reduce((n, r) => n + Number(r.amountMinor), 0);
    const expenseMinor = rows.filter((r) => r.type === "expense").reduce((n, r) => n + Number(r.amountMinor), 0);
    totals = { revenueMinor, expenseMinor, netProfitMinor: revenueMinor - expenseMinor };
    columns = ["code", "name", "type", "amountMinor"];
  } else if (type === "balance-sheet") {
    rows = await ledgerSummary(db, organizationId, { ...filters, from: "0001-01-01", to: filters.asOf ?? filters.to }, ["asset", "liability", "equity"]);
    rows = rows.map((r) => ({ ...r, amountMinor: r.type === "asset" ? Number(r.debitMinor) - Number(r.creditMinor) : Number(r.creditMinor) - Number(r.debitMinor) }));
    const incomeStatement = await ledgerSummary(db, organizationId, { ...filters, from: "0001-01-01", to: filters.asOf ?? filters.to }, ["revenue", "expense"]);
    const currentEarningsMinor = incomeStatement.reduce((total, row) => total + (row.type === "revenue"
      ? Number(row.creditMinor) - Number(row.debitMinor)
      : Number(row.creditMinor) - Number(row.debitMinor)), 0);
    if (currentEarningsMinor !== 0) rows.push({ accountId: "current-earnings", code: "CURRENT-EARNINGS", name: "Current earnings", type: "equity", subtype: "current_earnings", amountMinor: currentEarningsMinor });
    const assetMinor = rows.filter((r) => r.type === "asset").reduce((n, r) => n + Number(r.amountMinor), 0);
    const liabilityMinor = rows.filter((r) => r.type === "liability").reduce((n, r) => n + Number(r.amountMinor), 0);
    const equityMinor = rows.filter((r) => r.type === "equity").reduce((n, r) => n + Number(r.amountMinor), 0);
    totals = { assetMinor, liabilityMinor, equityMinor, differenceMinor: assetMinor - liabilityMinor - equityMinor };
    columns = ["code", "name", "type", "amountMinor"];
  } else if (type === "trial-balance") {
    rows = await ledgerSummary(db, organizationId, filters);
    totals = { debitMinor: rows.reduce((n, r) => n + Number(r.debitMinor), 0), creditMinor: rows.reduce((n, r) => n + Number(r.creditMinor), 0) };
    columns = ["code", "name", "debitMinor", "creditMinor", "netDebitMinor"];
  } else if (["general-ledger", "transaction-detail"].includes(type)) {
    const dim = whereDimensions(filters);
    const result = await db.prepare(`SELECT j.entry_number AS entryNumber, j.posting_date AS postingDate, j.description AS journalDescription,
        j.reference, a.code AS accountCode, a.name AS accountName, l.description, l.debit_minor AS debitMinor,
        l.credit_minor AS creditMinor, c.name AS contact, p.name AS project
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_entry_id AND j.organization_id = l.organization_id
      JOIN accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
      LEFT JOIN contacts c ON c.id = l.contact_id AND c.organization_id = l.organization_id
      LEFT JOIN projects p ON p.id = l.project_id AND p.organization_id = l.organization_id
      WHERE l.organization_id = ? AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN ? AND ?${dim.sql}
      ORDER BY j.posting_date, j.entry_number, l.id LIMIT 10000`)
      .bind(organizationId, filters.from ?? "0001-01-01", filters.to ?? "9999-12-31", ...dim.values).all<Record<string, unknown>>();
    rows = result.results;
    columns = ["entryNumber", "postingDate", "accountCode", "accountName", "description", "debitMinor", "creditMinor", "contact", "project"];
  } else if (type === "receivables-ageing" || type === "payables-ageing") {
    const docType = type === "receivables-ageing" ? "invoice" : "bill";
    const asOf = filters.asOf ?? filters.to ?? new Date().toISOString().slice(0, 10);
    const result = await db.prepare(`SELECT d.id, d.number, c.name AS contact, d.issue_date AS issueDate, d.due_date AS dueDate,
        d.total_minor AS totalMinor, d.paid_minor AS paidMinor, d.total_minor - d.paid_minor AS outstandingMinor,
        CAST(julianday(?) - julianday(COALESCE(d.due_date, d.issue_date)) AS INTEGER) AS daysOverdue
      FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id AND c.organization_id = d.organization_id
      WHERE d.organization_id = ? AND d.type = ? AND d.status IN ('open', 'partially_paid') AND d.issue_date <= ?
      ORDER BY d.due_date, d.number`).bind(asOf, organizationId, docType, asOf).all<Record<string, unknown>>();
    rows = result.results.map((r) => {
      const days = Number(r.daysOverdue);
      return { ...r, bucket: days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+" };
    });
    totals = { outstandingMinor: rows.reduce((n, r) => n + Number(r.outstandingMinor), 0) };
    columns = ["number", "contact", "issueDate", "dueDate", "outstandingMinor", "daysOverdue", "bucket"];
  } else if (type === "sales-analysis" || type === "expense-analysis") {
    const docType = type === "sales-analysis" ? "invoice" : "bill";
    const result = await db.prepare(`SELECT c.id AS contactId, c.name AS contact, p.id AS productId, p.name AS product,
        SUM(dl.quantity_micros) AS quantityMicros, SUM(dl.subtotal_minor) AS subtotalMinor, SUM(dl.tax_minor) AS taxMinor, SUM(dl.total_minor) AS totalMinor
      FROM document_lines dl JOIN documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id
      LEFT JOIN contacts c ON c.id = d.contact_id AND c.organization_id = d.organization_id
      LEFT JOIN products p ON p.id = dl.product_id AND p.organization_id = dl.organization_id
      WHERE dl.organization_id = ? AND d.type = ? AND d.status IN ('open','partially_paid','paid') AND d.issue_date BETWEEN ? AND ?
      GROUP BY c.id, c.name, p.id, p.name ORDER BY totalMinor DESC`)
      .bind(organizationId, docType, filters.from ?? "0001-01-01", filters.to ?? "9999-12-31").all<Record<string, unknown>>();
    rows = result.results;
    totals = { totalMinor: rows.reduce((n, r) => n + Number(r.totalMinor), 0) };
    columns = ["contact", "product", "quantityMicros", "subtotalMinor", "taxMinor", "totalMinor"];
  } else if (type === "inventory-valuation") {
    const result = await db.prepare(`SELECT sku, name, quantity_on_hand_micros AS quantityMicros, average_cost_minor AS averageCostMinor,
        ROUND(quantity_on_hand_micros * average_cost_minor / 1000000.0) AS valuationMinor,
        reorder_point_micros AS reorderPointMicros, quantity_on_hand_micros <= reorder_point_micros AS belowReorderPoint
      FROM products WHERE organization_id = ? AND type = 'inventory' AND active = 1 ORDER BY name`).bind(organizationId).all<Record<string, unknown>>();
    rows = result.results;
    totals = { valuationMinor: rows.reduce((n, r) => n + Number(r.valuationMinor), 0) };
    columns = ["sku", "name", "quantityMicros", "averageCostMinor", "valuationMinor", "reorderPointMicros", "belowReorderPoint"];
  } else if (type === "project-profitability") {
    const result = await db.prepare(`SELECT p.id AS projectId, p.code, p.name, p.budget_amount_minor AS budgetMinor,
        SUM(CASE WHEN a.type = 'revenue' THEN l.base_credit_minor - l.base_debit_minor ELSE 0 END) AS revenueMinor,
        SUM(CASE WHEN a.type = 'expense' THEN l.base_debit_minor - l.base_credit_minor ELSE 0 END) AS expenseMinor
      FROM projects p LEFT JOIN journal_lines l ON l.project_id = p.id AND l.organization_id = p.organization_id
      LEFT JOIN journal_entries j ON j.id = l.journal_entry_id AND j.organization_id = l.organization_id AND j.status IN ('posted','reversed')
      LEFT JOIN accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
      WHERE p.organization_id = ? GROUP BY p.id, p.code, p.name, p.budget_amount_minor ORDER BY p.code`).bind(organizationId).all<Record<string, unknown>>();
    rows = result.results.map((r) => ({ ...r, profitMinor: Number(r.revenueMinor) - Number(r.expenseMinor) }));
    columns = ["code", "name", "budgetMinor", "revenueMinor", "expenseMinor", "profitMinor"];
  } else if (type === "budget-vs-actual") {
    const result = await db.prepare(`SELECT a.code, a.name, a.type, bl.period, SUM(bl.amount_minor) AS budgetMinor,
        COALESCE((SELECT SUM(CASE WHEN a.type IN ('revenue','liability','equity') THEN jl.base_credit_minor-jl.base_debit_minor ELSE jl.base_debit_minor-jl.base_credit_minor END)
          FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.status IN ('posted','reversed')
          WHERE jl.organization_id=bl.organization_id AND jl.account_id=bl.account_id AND substr(je.posting_date,1,7)=bl.period),0) AS actualMinor
      FROM budget_lines bl JOIN budgets b ON b.id=bl.budget_id AND b.organization_id=bl.organization_id
      JOIN accounts a ON a.id=bl.account_id AND a.organization_id=bl.organization_id
      WHERE bl.organization_id=? AND b.status='approved' GROUP BY a.code,a.name,a.type,bl.period ORDER BY bl.period,a.code`).bind(organizationId).all<Record<string, unknown>>();
    rows = result.results.map((r) => ({ ...r, varianceMinor: Number(r.actualMinor) - Number(r.budgetMinor) }));
    columns = ["period", "code", "name", "budgetMinor", "actualMinor", "varianceMinor"];
  } else if (type === "cash-flow") {
    const result = await db.prepare(`WITH cash_entries AS (
        SELECT DISTINCT l.journal_entry_id FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
        JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        WHERE l.organization_id=? AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN ? AND ? AND a.subtype='cash'
      ) SELECT CASE
          WHEN a.type IN ('revenue','expense') OR a.subtype IN ('receivable','payable','tax','payroll') THEN 'operating'
          WHEN a.type='asset' THEN 'investing'
          WHEN a.type IN ('liability','equity') THEN 'financing'
          ELSE 'other' END AS activity,
        a.code, a.name, SUM(l.base_credit_minor-l.base_debit_minor) AS amountMinor
      FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
      JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
      WHERE l.organization_id=? AND l.journal_entry_id IN (SELECT journal_entry_id FROM cash_entries) AND a.subtype!='cash'
      GROUP BY activity,a.code,a.name ORDER BY activity,a.code`)
      .bind(organizationId, filters.from ?? "0001-01-01", filters.to ?? "9999-12-31", organizationId).all<Record<string, unknown>>();
    rows = result.results;
    totals = {
      operatingMinor: rows.filter((r) => r.activity === "operating").reduce((n, r) => n + Number(r.amountMinor), 0),
      investingMinor: rows.filter((r) => r.activity === "investing").reduce((n, r) => n + Number(r.amountMinor), 0),
      financingMinor: rows.filter((r) => r.activity === "financing").reduce((n, r) => n + Number(r.amountMinor), 0),
      netCashChangeMinor: rows.reduce((n, r) => n + Number(r.amountMinor), 0),
    };
    columns = ["activity", "code", "name", "amountMinor"];
  } else if (type === "tax-summary" || type === "payroll-summary") {
    const subtype = type === "payroll-summary" ? "payroll" : "tax";
    rows = (await ledgerSummary(db, organizationId, filters)).filter((r) => String(r.subtype ?? "").toLowerCase().includes(subtype));
    columns = ["code", "name", "type", "subtype", "debitMinor", "creditMinor", "netDebitMinor"];
  } else if (type === "customer-statement" || type === "supplier-statement") {
    const docType=type==="customer-statement"?"invoice":"bill",paymentType=type==="customer-statement"?"receipt":"payment";
    const r=await db.prepare(`SELECT d.issue_date date,d.number reference,'document' source,d.total_minor debitMinor,d.paid_minor creditMinor,d.total_minor-d.paid_minor balanceMinor,c.name contact FROM documents d JOIN contacts c ON c.id=d.contact_id WHERE d.organization_id=? AND d.type=? AND d.issue_date BETWEEN ? AND ? AND (? IS NULL OR d.contact_id=?) UNION ALL SELECT p.payment_date,p.number,'payment',0,p.amount_minor,-p.amount_minor,c.name FROM payments p JOIN contacts c ON c.id=p.contact_id WHERE p.organization_id=? AND p.type=? AND p.status IN ('posted','reversed') AND p.payment_date BETWEEN ? AND ? AND (? IS NULL OR p.contact_id=?) ORDER BY date,reference`).bind(organizationId,docType,filters.from??"0001-01-01",filters.to??"9999-12-31",filters.contactId??null,filters.contactId??null,organizationId,paymentType,filters.from??"0001-01-01",filters.to??"9999-12-31",filters.contactId??null,filters.contactId??null).all<Record<string,unknown>>();rows=r.results;columns=["date","reference","source","contact","debitMinor","creditMinor","balanceMinor"];
  } else if (type === "changes-in-equity" || type === "retained-earnings") {
    rows=await ledgerSummary(db,organizationId,filters,["equity","revenue","expense"]);rows=rows.map(r=>({...r,amountMinor:["equity","revenue"].includes(String(r.type))?Number(r.creditMinor)-Number(r.debitMinor):Number(r.debitMinor)-Number(r.creditMinor)}));totals={changeMinor:rows.reduce((n,r)=>n+Number(r.amountMinor),0)};columns=["code","name","type","amountMinor"];
  } else if (type === "bank-reconciliation") {
    const r=await db.prepare(`SELECT a.id accountId,a.code,a.name,SUM(l.base_debit_minor-l.base_credit_minor) ledgerBalanceMinor,COALESCE(SUM(CASE WHEN p.status='draft' THEN CASE WHEN p.type='receipt' THEN p.amount_minor ELSE -p.amount_minor END ELSE 0 END),0) outstandingMinor FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id AND l.organization_id=a.organization_id LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.status IN ('posted','reversed') AND j.posting_date<=? LEFT JOIN payments p ON p.bank_account_id=a.id AND p.organization_id=a.organization_id WHERE a.organization_id=? AND a.subtype='cash' GROUP BY a.id,a.code,a.name`).bind(filters.asOf??filters.to??"9999-12-31",organizationId).all<Record<string,unknown>>();rows=r.results.map(x=>({...x,adjustedBalanceMinor:Number(x.ledgerBalanceMinor)+Number(x.outstandingMinor)}));columns=["code","name","ledgerBalanceMinor","outstandingMinor","adjustedBalanceMinor"];
  } else if (type === "fixed-asset-register" || type === "depreciation") {
    rows=(await ledgerSummary(db,organizationId,filters,["asset"])).filter(r=>String(r.subtype??"").includes(type==="depreciation"?"depreciation":"fixed"));columns=["code","name","subtype","debitMinor","creditMinor","netDebitMinor"];
  } else if (type === "detailed-tax-return") {
    const r=await db.prepare(`SELECT j.posting_date postingDate,j.entry_number entryNumber,j.reference,a.code accountCode,l.tax_code taxCode,l.debit_minor debitMinor,l.credit_minor creditMinor FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id JOIN accounts a ON a.id=l.account_id WHERE l.organization_id=? AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN ? AND ? AND (l.tax_code IS NOT NULL OR a.subtype LIKE '%tax%') ORDER BY j.posting_date,j.entry_number`).bind(organizationId,filters.from??"0001-01-01",filters.to??"9999-12-31").all<Record<string,unknown>>();rows=r.results;columns=["postingDate","entryNumber","reference","accountCode","taxCode","debitMinor","creditMinor"];
  } else if (type === "consolidated-statements" || type === "comparative-statements") {
    const current=await ledgerSummary(db,organizationId,filters);let prior:Record<string,unknown>[]=[];if(type==="comparative-statements"&&filters.from&&filters.to){const f=new Date(filters.from),t=new Date(filters.to);f.setUTCFullYear(f.getUTCFullYear()-1);t.setUTCFullYear(t.getUTCFullYear()-1);prior=await ledgerSummary(db,organizationId,{...filters,from:f.toISOString().slice(0,10),to:t.toISOString().slice(0,10)})}const byId=new Map(prior.map(x=>[x.accountId,x]));rows=current.map(x=>({...x,currentMinor:Number(x.netDebitMinor),priorMinor:Number(byId.get(x.accountId)?.netDebitMinor??0),varianceMinor:Number(x.netDebitMinor)-Number(byId.get(x.accountId)?.netDebitMinor??0)}));columns=["code","name","type","currentMinor","priorMinor","varianceMinor"];
  }
  return { reportType: type, generatedAt: now, filters, columns, rows, ...(totals ? { totals } : {}) };
}

export function toCsv(report: ReportResult): string {
  const escape = (value: unknown): string => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [report.columns.join(","), ...report.rows.map((row) => report.columns.map((column) => escape(row[column])).join(","))].join("\n");
}

export function toXlsx(report:ReportResult):Uint8Array{
  const sheet=XLSX.utils.json_to_sheet(report.rows,{header:report.columns});
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,"Report");
  workbook.Props={Title:report.reportType,CreatedDate:new Date(report.generatedAt)};
  return XLSX.write(workbook,{type:"array",bookType:"xlsx",compression:true}) as Uint8Array;
}

export async function toPdf(report:ReportResult,organization?:Record<string,unknown>|null):Promise<Uint8Array>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=842,H=595,M=38,rowH=19,usable=W-M*2,cols=report.columns,weights=cols.map(c=>/name|description/i.test(c)?2.2:/amount|debit|credit|balance|minor/i.test(c)?1.25:1),unit=usable/weights.reduce((a,b)=>a+b,0),widths=weights.map(x=>x*unit);
  let page=pdf.addPage([W,H]),y=H-M,pageNo=1;
  const label=(s:string)=>s.replace(/Minor$/," Amount").replace(/([A-Z])/g," $1").replace(/^./,x=>x.toUpperCase());
  const value=(v:unknown,c:string)=>v==null?"":c.toLowerCase().includes("minor")?(Number(v)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):String(v).replaceAll("\n"," ");
  const fit=(s:string,w:number,size=7)=>{const max=Math.max(2,Math.floor(w/(size*.52)));return s.length>max?s.slice(0,max-1)+"…":s};
  const header=()=>{const org=String(organization?.legalName||organization?.name||"Your Finance Pro"),branding=JSON.parse(String(organization?.branding||"{}")),address=JSON.parse(String(organization?.address||"{}"));page.drawText(org,{x:M,y,font:bold,size:13,color:rgb(.05,.25,.2)});y-=18;const orgLine=[address.formatted,organization?.taxNumber&&`Tax ID: `,branding.email,branding.phone,branding.website].filter(Boolean).join(" | ");if(orgLine){page.drawText(fit(String(orgLine),usable,7),{x:M,y,font,size:7,color:rgb(.4,.45,.5)});y-=16}page.drawText(report.reportType.replaceAll("-"," ").toUpperCase(),{x:M,y,font:bold,size:18,color:rgb(.05,.25,.2)});page.drawText(`Generated ${new Date(report.generatedAt).toLocaleString("en-GB")}`,{x:M,y:y-18,font,size:7,color:rgb(.4,.45,.5)});const range=report.filters.asOf?`As of ${report.filters.asOf}`:[report.filters.from,report.filters.to].filter(Boolean).join(" to ");if(range)page.drawText(range,{x:W-M-font.widthOfTextAtSize(range,8),y,font,size:8,color:rgb(.3,.35,.4)});y-=36;page.drawRectangle({x:M,y:y-rowH+5,width:usable,height:rowH, color:rgb(.08,.16,.26)});let x=M;cols.forEach((c,i)=>{page.drawText(fit(label(c),widths[i]!-8,7),{x:x+4,y:y-8,font:bold,size:7,color:rgb(1,1,1)});x+=widths[i]!});y-=rowH};header();
  for(let r=0;r<report.rows.length;r++){if(y<M+35){page.drawText(`Page ${pageNo++}`,{x:W-M-35,y:18,font,size:7,color:rgb(.5,.5,.5)});page=pdf.addPage([W,H]);y=H-M;header()}if(r%2===1)page.drawRectangle({x:M,y:y-rowH+5,width:usable,height:rowH,color:rgb(.96,.97,.98)});let x=M;cols.forEach((c,i)=>{const text=fit(value(report.rows[r]![c],c),widths[i]!-8);page.drawText(text,{x:x+4,y:y-8,font,size:7,color:rgb(.12,.16,.22)});x+=widths[i]!});page.drawLine({start:{x:M,y:y-rowH+5},end:{x:W-M,y:y-rowH+5},thickness:.3,color:rgb(.84,.87,.9)});y-=rowH}
  if(!report.rows.length){page.drawText("No records match the selected reporting period and filters.",{x:M,y:y-8,font,size:10,color:rgb(.4,.45,.5)});y-=28}
  if(report.totals){y-=8;page.drawText("TOTALS",{x:M,y,font:bold,size:9,color:rgb(.05,.25,.2)});y-=16;for(const[k,v]of Object.entries(report.totals)){page.drawText(label(k),{x:M,y,font,size:8});const amount=(v/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});page.drawText(amount,{x:W-M-font.widthOfTextAtSize(amount,8),y,font:bold,size:8});y-=14}}
  page.drawText(`Page ${pageNo}`,{x:W-M-35,y:18,font,size:7,color:rgb(.5,.5,.5)});
  return pdf.save();
}
