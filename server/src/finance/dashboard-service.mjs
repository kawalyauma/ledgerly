import {TenantCache} from '../cache/tenant-cache.mjs';

function number(value){const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;}
function monthLabel(date){return date.toLocaleDateString('en',{month:'long',year:'numeric',timeZone:'UTC'});}

export class FinanceDashboardService{
  constructor({database,cache}){if(!database?.query)throw new TypeError('database is required');if(!cache)throw new TypeError('cache is required');this.db=database;this.cache=cache;}
  tenant(organizationId){return new TenantCache({cache:this.cache,organizationId});}
  summary(organizationId,userId){return this.tenant(organizationId).remember('dashboard-summary',`user-${userId}`,()=>this.#loadSummary(organizationId,userId),{ttlMs:30000});}
  async #loadSummary(organizationId,userId){
    const now=new Date(),to=now.toISOString().slice(0,10),from=`${to.slice(0,7)}-01`;
    const [identity,cash,periodCash,outstanding,recent,monthly]=await Promise.all([
      this.db.query(`SELECT o.name,o.base_currency AS "baseCurrency",u.display_name AS "userName" FROM organizations o JOIN users u ON u.id=$1 WHERE o.id=$2`,[userId,organizationId]),
      this.db.query(`SELECT COALESCE(SUM(l.base_debit_minor-l.base_credit_minor),0)::bigint AS "balanceMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND a.subtype='cash' AND j.posting_date<=$2::date`,[organizationId,to]),
      this.db.query(`SELECT COALESCE(SUM(l.base_debit_minor),0)::bigint AS "moneyInMinor",COALESCE(SUM(l.base_credit_minor),0)::bigint AS "moneyOutMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND a.subtype='cash' AND j.posting_date BETWEEN $2::date AND $3::date`,[organizationId,from,to]),
      this.db.query(`SELECT COALESCE(SUM(total_minor-paid_minor),0)::bigint AS "outstandingMinor",COUNT(*)::bigint AS "outstandingCount" FROM documents WHERE organization_id=$1 AND type='invoice' AND status IN ('open','partially_paid')`,[organizationId]),
      this.db.query(`SELECT j.id,j.entry_number AS "entryNumber",j.posting_date AS "postingDate",j.description,j.reference,j.status,j.currency,COALESCE(SUM(CASE WHEN a.subtype='cash' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::bigint AS "cashDeltaMinor" FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE j.organization_id=$1 AND j.status IN ('posted','reversed') GROUP BY j.id ORDER BY j.posting_date DESC,j.entry_number DESC LIMIT 5`,[organizationId]),
      this.db.query(`SELECT to_char(j.posting_date,'YYYY-MM') AS month,COALESCE(SUM(l.base_debit_minor),0)::bigint AS "moneyInMinor",COALESCE(SUM(l.base_credit_minor),0)::bigint AS "moneyOutMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND a.subtype='cash' AND j.posting_date>=date_trunc('month',$2::date)-interval '11 months' GROUP BY month ORDER BY month`,[organizationId,to]),
    ]);
    const who=identity.rows[0];if(!who){const error=new Error('Organization not found');error.status=404;error.code='NOT_FOUND';throw error;}
    const byMonth=new Map(monthly.rows.map(row=>[String(row.month),row]));
    const cashFlow=Array.from({length:12},(_,index)=>{const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11+index,1)),month=date.toISOString().slice(0,7),row=byMonth.get(month);return{month,moneyInMinor:number(row?.moneyInMinor),moneyOutMinor:number(row?.moneyOutMinor)};});
    return{organization:{name:who.name,baseCurrency:who.baseCurrency},user:{name:who.userName},period:{from,to,label:monthLabel(now)},metrics:{balanceMinor:number(cash.rows[0]?.balanceMinor),moneyInMinor:number(periodCash.rows[0]?.moneyInMinor),moneyOutMinor:number(periodCash.rows[0]?.moneyOutMinor),outstandingMinor:number(outstanding.rows[0]?.outstandingMinor),outstandingCount:number(outstanding.rows[0]?.outstandingCount)},cashFlow,transactions:recent.rows.map(row=>{const delta=number(row.cashDeltaMinor),entryNumber=Number(row.entryNumber);return{id:String(row.id),entryNumber:Number.isFinite(entryNumber)?entryNumber:null,postingDate:String(row.postingDate),description:String(row.description),reference:row.reference==null?null:String(row.reference),status:String(row.status),currency:String(row.currency),amountMinor:Math.abs(delta),direction:delta>=0?'income':'expense'};}),generatedAt:new Date().toISOString()};
  }
}
