export function financeError(status, code, message, details) {
  const error = new Error(message); error.status=status; error.code=code; if(details!==undefined)error.details=details; return error;
}
export function mapFinanceError(error) {
  if(error?.status)return error; const code=String(error?.code||'FINANCE_ERROR');
  const status=({JOURNAL_NOT_FOUND:404,PAYMENT_NOT_FOUND:404,DOCUMENT_NOT_FOUND:404,ACCOUNT_NOT_FOUND:404,NOT_FOUND:404,IDEMPOTENCY_CONFLICT:409,CONCURRENT_JOURNAL_CHANGE:409,CONCURRENT_PAYMENT_CHANGE:409,SCHOOL_FEE_REVERSAL_CONFLICT:409,DOCUMENT_REVERSAL_CONFLICT:409,INVALID_JOURNAL_STATE:409,INVALID_PAYMENT_STATE:409,PAYMENT_NOT_POSTED:409,DOCUMENT_NOT_OPEN:409,ALLOCATION_ALREADY_REVERSED:409,ACCOUNT_IN_USE:409,GROUP_IN_USE:409,REVERSAL_BLOCKED:409,DOCUMENT_HAS_PAYMENTS:409,PAYROLL_HAS_SALARY_PAYMENTS:409,CHARGE_HAS_SETTLEMENTS:409,INVALID_PAYROLL_RUN_STATE:409,PAYROLL_CONCURRENT_CHANGE:409,PAYROLL_REVERSAL_CONFLICT:409,RECONCILIATION_NOT_BALANCED:409,INVALID_TAX_RETURN_STATE:409,INCOMPATIBLE_ACCOUNTS:422,PAYMENT_OVERALLOCATED:422,DOCUMENT_OVERALLOCATED:422,ALLOCATION_MISMATCH:422,ALLOCATION_TARGET_NOT_FOUND:422,INVALID_ALLOCATION:422,UNBALANCED_JOURNAL:422,INVALID_CONTACT:422,INVALID_ACCOUNT:422,INVALID_BANK_ACCOUNT:422,INVALID_CONTROL_ACCOUNT:422,INVALID_PARENT:422,VALIDATION_ERROR:422,INVALID_PAYROLL_PAYMENT:422,PAYROLL_PAYMENT_MISMATCH:422,PAYROLL_OVERPAYMENT:422})[code]||500;
  return financeError(status,code,error instanceof Error?error.message:String(error),error?.details);
}
export async function authenticateFinance(runtime,request,scope){const p=await runtime.auth.authenticateRequest({headers:request.headers});if(scope)runtime.auth.requireScope(p,scope);return p}
export async function readJson(request,{optional=false}={}){try{return await request.json()}catch{if(optional)return{};throw financeError(422,'VALIDATION_ERROR','Request body must be valid JSON')}}
export function requiredHeader(request,name,max=200){const v=String(request.headers.get(name)||'').trim();if(!v||v.length>max)throw financeError(422,`${name.toUpperCase().replace(/-/g,'_')}_REQUIRED`,`${name} header is required`);return v}
export function requireNodeCutover(extension,field,code='FINANCE_WRITE_NOT_CUT_OVER'){
  if(extension?.[field]!=='node')throw financeError(503,code,'This finance capability is not yet Node-authoritative');
}
export function pagination(url){const l=Number(url.searchParams.get('limit')||50),o=Number(url.searchParams.get('offset')||0);return{limit:Number.isInteger(l)?Math.max(1,Math.min(l,200)):50,offset:Number.isInteger(o)?Math.max(0,o):0}}
export const ok=(body,status=200,headers={})=>({status,body,headers});
