const boolean = value => value == null ? value : Boolean(Number(value));
function rowTable(name, columns, {booleans=[], dependencies=[]}={}) {
  return Object.freeze({name,columns:Object.freeze(columns),conflict:Object.freeze(['id']),dependencies:Object.freeze(dependencies),transform(row){const out={};for(const c of columns)out[c]=row[c]??null;for(const c of booleans)if(out[c]!=null)out[c]=boolean(out[c]);return out;}});
}
export const PAYROLL_TABLES=Object.freeze([
  rowTable('employees',['id','organization_id','contact_id','employee_number','hire_date','termination_date','pay_type','base_pay_minor','currency','tax_identifier','bank_details_encrypted','active','created_at','updated_at'],{booleans:['active'],dependencies:['contacts']}),
  rowTable('payroll_runs',['id','organization_id','number','period_start','period_end','pay_date','status','currency','gross_minor','deductions_minor','employer_costs_minor','net_minor','journal_entry_id','reversal_run_id','payment_batch_id','calculation_snapshot','created_at','updated_at'],{dependencies:['journal_entries']}),
  rowTable('payroll_lines',['id','organization_id','payroll_run_id','employee_id','gross_minor','deductions_minor','employer_costs_minor','net_minor','components','paid_minor','balance_minor','payment_status','payslip_object_key','delivered_at','created_at','updated_at'],{dependencies:['payroll_runs','employees']}),
  rowTable('payroll_components',['id','organization_id','code','name','type','calculation_type','rate_micros','amount_minor','taxable','pensionable','statutory','employer_rate_micros','active','created_at','updated_at'],{booleans:['taxable','pensionable','statutory','active']}),
  rowTable('payroll_rules',['id','organization_id','name','country_code','currency','effective_from','effective_to','status','settings','created_at','updated_at']),
  rowTable('payroll_rule_bands',['id','organization_id','rule_id','kind','lower_minor','upper_minor','rate_micros','fixed_minor','employee_rate_micros','employer_rate_micros','created_at'],{dependencies:['payroll_rules']}),
  rowTable('employee_payroll_components',['id','organization_id','employee_id','component_id','amount_minor','rate_micros','effective_from','effective_to','created_at'],{dependencies:['employees','payroll_components']}),
  rowTable('payroll_inputs',['id','organization_id','employee_id','input_date','type','units_micros','amount_minor','status','metadata','created_at'],{dependencies:['employees']}),
  rowTable('payroll_payment_batches',['id','organization_id','payroll_run_id','number','status','bank_account_id','payment_date','total_minor','items','approved_by','processed_at','created_at','updated_at'],{dependencies:['payroll_runs','accounts']}),
  rowTable('payroll_statutory_returns',['id','organization_id','payroll_run_id','year','period','authority','type','status','amount_minor','payload','filed_at','created_at','updated_at'],{dependencies:['payroll_runs']}),
  rowTable('pay_mobile_payment_intents',['id','organization_id','device_id','payload_json','created_by','client_created_at','status','server_payment_id','error_message','attempts','last_attempt_at','next_attempt_at','applied_at','created_at','updated_at'],{dependencies:['payments']})
]);
