import {FinanceIntegrityError} from './transactions.mjs';

export class PayrollTransactions {
  constructor({database}) { if(!database?.transaction) throw new TypeError('database.transaction is required'); this.database=database; }

  async recordSalaryPayment({organizationId,payrollLineId,paymentId,amountMinor,schoolStaffPayment=null}) {
    const amount=BigInt(amountMinor);
    if(amount<=0n) throw new FinanceIntegrityError('INVALID_PAYROLL_PAYMENT','Salary payment must be positive');
    return this.database.transaction(async tx=>{
      const payment=(await tx.query(`SELECT id,status,amount_minor FROM payments WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[paymentId,organizationId])).rows[0];
      if(!payment||payment.status!=='posted') throw new FinanceIntegrityError('PAYMENT_NOT_POSTED','Posted salary payment not found');
      if(BigInt(payment.amount_minor)!==amount) throw new FinanceIntegrityError('PAYROLL_PAYMENT_MISMATCH','Salary payment amount differs from payment');
      const line=(await tx.query(`SELECT id,net_minor,paid_minor,balance_minor,payment_status FROM payroll_lines WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[payrollLineId,organizationId])).rows[0];
      if(!line) throw new FinanceIntegrityError('PAYROLL_LINE_NOT_FOUND','Payroll line not found');
      if(amount>BigInt(line.balance_minor)) throw new FinanceIntegrityError('PAYROLL_OVERPAYMENT','Salary payment exceeds payroll balance');
      const updated=await tx.query(`UPDATE payroll_lines SET paid_minor=paid_minor+$3,balance_minor=balance_minor-$3,payment_status=CASE WHEN balance_minor-$3=0 THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=$1 AND organization_id=$2 AND balance_minor >= $3 RETURNING id,paid_minor,balance_minor,payment_status`,[payrollLineId,organizationId,amount.toString()]);
      if(updated.rowCount!==1) throw new FinanceIntegrityError('PAYROLL_CONCURRENT_CHANGE','Payroll line changed while applying salary payment');
      if(schoolStaffPayment){
        await tx.query(`INSERT INTO school_staff_salary_payments(id,organization_id,staff_id,payroll_line_id,payment_id,amount_minor,payment_date,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'posted',$8,now(),now()) ON CONFLICT (organization_id,payment_id) DO NOTHING`,[schoolStaffPayment.id,organizationId,schoolStaffPayment.staffId,payrollLineId,paymentId,amount.toString(),schoolStaffPayment.paymentDate,schoolStaffPayment.createdBy]);
      }
      return updated.rows[0];
    });
  }

  async reverseSalaryPayment({organizationId,paymentId,reason}) {
    return this.database.transaction(async tx=>{
      const school=(await tx.query(`SELECT id,payroll_line_id,amount_minor,status FROM school_staff_salary_payments WHERE organization_id=$1 AND payment_id=$2 FOR UPDATE`,[organizationId,paymentId])).rows[0];
      if(!school) throw new FinanceIntegrityError('PAYROLL_LINK_MISSING','Salary payment has no payroll linkage');
      if(school.status==='reversed') return {alreadyReversed:true,payrollLineId:school.payroll_line_id};
      const payment=(await tx.query(`SELECT id,status FROM payments WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[paymentId,organizationId])).rows[0];
      if(!payment) throw new FinanceIntegrityError('PAYMENT_NOT_FOUND','Payment not found');
      if(payment.status!=='reversed') throw new FinanceIntegrityError('PAYMENT_NOT_REVERSED','Reverse the accounting payment before restoring payroll balance');
      const line=await tx.query(`UPDATE payroll_lines SET paid_minor=GREATEST(0,paid_minor-$3),balance_minor=net_minor-GREATEST(0,paid_minor-$3),payment_status=CASE WHEN GREATEST(0,paid_minor-$3)=0 THEN 'unpaid' WHEN net_minor-GREATEST(0,paid_minor-$3)=0 THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=$1 AND organization_id=$2 AND paid_minor >= $3 RETURNING id,paid_minor,balance_minor,payment_status`,[school.payroll_line_id,organizationId,school.amount_minor]);
      if(line.rowCount!==1) throw new FinanceIntegrityError('PAYROLL_REVERSAL_CONFLICT','Payroll balance changed while reversing salary payment');
      await tx.query(`UPDATE school_staff_salary_payments SET status='reversed',reversed_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='posted'`,[school.id,organizationId]);
      return {...line.rows[0],reason};
    });
  }

  async assertRunReversible({organizationId,payrollRunId}) {
    return this.database.transaction(async tx=>{
      const run=(await tx.query(`SELECT id,status,journal_entry_id FROM payroll_runs WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[payrollRunId,organizationId])).rows[0];
      if(!run||run.status!=='posted'||!run.journal_entry_id) throw new FinanceIntegrityError('INVALID_PAYROLL_RUN_STATE','Posted payroll run not found');
      const paid=(await tx.query(`SELECT COALESCE(SUM(paid_minor),0)::bigint AS paid_minor FROM payroll_lines WHERE payroll_run_id=$1 AND organization_id=$2 FOR UPDATE`,[payrollRunId,organizationId])).rows[0];
      if(BigInt(paid?.paid_minor??0)>0n) throw new FinanceIntegrityError('PAYROLL_HAS_SALARY_PAYMENTS','Reverse all salary payments before reversing payroll');
      return run;
    });
  }
}
