import {randomUUID} from 'node:crypto';
import {createId} from '../auth/crypto.mjs';
import {createPostCommitInvalidator} from '../cache/tenant-cache.mjs';
import {FinanceIntegrityError} from './transactions.mjs';

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const EARNING_TYPES=new Set(['overtime','benefit','earning','commission','allowance','bonus','other_earning']);
const DEDUCTION_TYPES=new Set(['deduction','loan_recovery','salary_advance','other_deduction']);
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new TypeError(`${n} is required`);return s;};
const integer=(v,n)=>{const x=Number(v);if(!Number.isSafeInteger(x))throw new TypeError(`${n} must be an integer`);return x;};
const asBig=v=>BigInt(v??0);
const roundedMicros=(base,rate)=>BigInt(Math.round(Number(base)*Number(rate??0)/1_000_000));

export class PayrollCalculationService{
  constructor({database,cache}){if(!database?.transaction)throw new TypeError('database.transaction is required');this.db=database;this.cache=cache;}
  validate(input={}){
    const v={...input,number:text(input.number,'number'),periodStart:text(input.periodStart,'periodStart'),periodEnd:text(input.periodEnd,'periodEnd'),payDate:text(input.payDate,'payDate'),currency:text(input.currency,'currency').toUpperCase(),ruleId:text(input.ruleId,'ruleId')};
    if(!DATE_RE.test(v.periodStart)||!DATE_RE.test(v.periodEnd)||!DATE_RE.test(v.payDate)||v.periodStart>v.periodEnd)throw new TypeError('Invalid payroll period');
    if(!/^[A-Z]{3}$/.test(v.currency))throw new TypeError('currency must be a three-letter code');
    if(v.employeeIds!=null&&(!Array.isArray(v.employeeIds)||v.employeeIds.some(id=>typeof id!=='string'||!id.trim())))throw new TypeError('employeeIds must contain employee ids');
    v.employeeIds=v.employeeIds?.map(x=>x.trim());
    return v;
  }
  async calculate({organizationId,actorId,input}){
    const org=text(organizationId,'organizationId'),actor=text(actorId,'actorId'),v=this.validate(input),invalidator=createPostCommitInvalidator({cache:this.cache,organizationId:org});
    invalidator.mark('dashboard-summary','reference-counts');
    try{
      const result=await this.db.transaction(async tx=>{
        const rule=(await tx.query(`SELECT id,currency FROM payroll_rules WHERE id=$1 AND organization_id=$2 AND status='active' AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$4) FOR SHARE`,[v.ruleId,org,v.periodEnd,v.periodStart])).rows[0];
        if(!rule)throw new FinanceIntegrityError('PAYROLL_RULE_NOT_ACTIVE','Active payroll rule not found for the selected period');
        if(String(rule.currency).toUpperCase()!==v.currency)throw new FinanceIntegrityError('PAYROLL_CURRENCY_MISMATCH','Payroll rule currency does not match payroll run currency');
        const employeeSql=v.employeeIds?.length?`SELECT id,employee_number,base_pay_minor,currency FROM employees WHERE organization_id=$1 AND active=true AND id=ANY($2::text[]) ORDER BY employee_number FOR UPDATE`:`SELECT id,employee_number,base_pay_minor,currency FROM employees WHERE organization_id=$1 AND active=true ORDER BY employee_number FOR UPDATE`;
        const employees=(await tx.query(employeeSql,v.employeeIds?.length?[org,v.employeeIds]:[org])).rows;
        if(v.employeeIds?.length&&employees.length!==new Set(v.employeeIds).size)throw new FinanceIntegrityError('INVALID_EMPLOYEE','Every selected payroll employee must be active');
        if(!employees.length)throw new FinanceIntegrityError('NO_PAYROLL_EMPLOYEES','No active payroll employees found');
        if(employees.some(e=>String(e.currency).toUpperCase()!==v.currency))throw new FinanceIntegrityError('PAYROLL_CURRENCY_MISMATCH','Every payroll employee must use the payroll run currency');
        const ids=employees.map(e=>e.id);
        const bands=(await tx.query(`SELECT id,kind,lower_minor,upper_minor,rate_micros,fixed_minor,employee_rate_micros,employer_rate_micros FROM payroll_rule_bands WHERE organization_id=$1 AND rule_id=$2 ORDER BY lower_minor,id FOR SHARE`,[org,v.ruleId])).rows;
        const inputs=(await tx.query(`SELECT id,employee_id,input_date,type,amount_minor FROM payroll_inputs WHERE organization_id=$1 AND employee_id=ANY($2::text[]) AND status='approved' AND input_date BETWEEN $3 AND $4 ORDER BY employee_id,input_date,id FOR UPDATE`,[org,ids,v.periodStart,v.periodEnd])).rows;
        const inputByEmployee=new Map();for(const row of inputs){const list=inputByEmployee.get(row.employee_id)??[];list.push(row);inputByEmployee.set(row.employee_id,list);}
        let compensation=[];const optional=(await tx.query(`SELECT to_regclass('public.school_staff_compensation') AS table_name`)).rows[0]?.table_name;
        if(optional)compensation=(await tx.query(`SELECT payroll_employee_id AS employee_id,component_type AS type,name,amount_minor FROM school_staff_compensation WHERE organization_id=$1 AND payroll_employee_id=ANY($2::text[]) AND active=true ORDER BY payroll_employee_id,id FOR SHARE`,[org,ids])).rows;
        const compByEmployee=new Map();for(const row of compensation){const list=compByEmployee.get(row.employee_id)??[];list.push(row);compByEmployee.set(row.employee_id,list);}
        const lines=[];let grossTotal=0n,deductionTotal=0n,employerTotal=0n,netTotal=0n;
        for(const employee of employees){
          let gross=asBig(employee.base_pay_minor),deductions=0n,employerCosts=0n;const components=[];
          for(const c of compByEmployee.get(employee.id)??[]){const amount=asBig(c.amount_minor);if(String(c.type).toLowerCase()==='deduction'){deductions+=amount;components.push({code:'COMPENSATION_DEDUCTION',name:c.name??'Recurring deduction',type:'deduction',amountMinor:Number(amount)});}else{gross+=amount;components.push({code:'COMPENSATION_EARNING',name:c.name??'Recurring earning',type:'earning',amountMinor:Number(amount)});}}
          for(const row of inputByEmployee.get(employee.id)??[]){const amount=asBig(row.amount_minor),type=String(row.type||'').toLowerCase();if(type==='leave_unpaid'){gross=amount>gross?0n:gross-amount;components.push({code:'LEAVE_UNPAID',type:'deduction',amountMinor:Number(amount)});}else if(EARNING_TYPES.has(type)){gross+=amount;components.push({code:type.toUpperCase(),type:'earning',amountMinor:Number(amount)});}else if(DEDUCTION_TYPES.has(type)){deductions+=amount;components.push({code:type.toUpperCase(),type:'deduction',amountMinor:Number(amount)});}}
          for(const band of bands){const lower=asBig(band.lower_minor),upper=band.upper_minor==null?gross:asBig(band.upper_minor),ceiling=gross<upper?gross:upper,taxable=ceiling>lower?ceiling-lower:0n;if(taxable<=0n)continue;const employeeRate=band.employee_rate_micros??band.rate_micros,employeeAmount=asBig(band.fixed_minor)+roundedMicros(taxable,employeeRate),employerAmount=roundedMicros(taxable,band.employer_rate_micros);if(employeeAmount>0n){deductions+=employeeAmount;components.push({code:String(band.kind||'STATUTORY').toUpperCase(),type:'deduction',amountMinor:Number(employeeAmount)});}if(employerAmount>0n){employerCosts+=employerAmount;components.push({code:`${String(band.kind||'STATUTORY').toUpperCase()}_EMPLOYER`,type:'employer_cost',amountMinor:Number(employerAmount)});}}
          if(deductions>gross)deductions=gross;const net=gross-deductions;grossTotal+=gross;deductionTotal+=deductions;employerTotal+=employerCosts;netTotal+=net;lines.push({employeeId:employee.id,grossMinor:gross,deductionsMinor:deductions,employerCostsMinor:employerCosts,netMinor:net,components});
        }
        const runId=createId('pyr');
        await tx.query(`INSERT INTO payroll_runs(id,organization_id,number,period_start,period_end,pay_date,status,currency,gross_minor,deductions_minor,employer_costs_minor,net_minor,calculation_snapshot,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,now(),now())`,[runId,org,v.number,v.periodStart,v.periodEnd,v.payDate,v.currency,String(grossTotal),String(deductionTotal),String(employerTotal),String(netTotal),JSON.stringify({ruleId:v.ruleId,employeeIds:ids,calculatedAt:new Date().toISOString()})]);
        for(const line of lines)await tx.query(`INSERT INTO payroll_lines(id,organization_id,payroll_run_id,employee_id,gross_minor,deductions_minor,employer_costs_minor,net_minor,components,paid_minor,balance_minor,payment_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$8,'unpaid',now(),now())`,[createId('pyl'),org,runId,line.employeeId,String(line.grossMinor),String(line.deductionsMinor),String(line.employerCostsMinor),String(line.netMinor),JSON.stringify(line.components)]);
        await tx.query(`INSERT INTO ledgerly_meta.audit_events(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,after_data,metadata,occurred_at) VALUES($1,$2,'human',$3,'payroll.calculated','payroll_run',$4,$5::jsonb,'{}'::jsonb,now())`,[randomUUID(),org,actor,runId,JSON.stringify({number:v.number,employeeCount:lines.length,grossMinor:String(grossTotal),netMinor:String(netTotal)})]);
        return{id:runId,status:'draft',grossMinor:Number(grossTotal),deductionsMinor:Number(deductionTotal),employerCostsMinor:Number(employerTotal),netMinor:Number(netTotal),employeeCount:lines.length};
      });
      await invalidator.committed();return result;
    }catch(error){invalidator.rollback();throw error;}
  }
}
