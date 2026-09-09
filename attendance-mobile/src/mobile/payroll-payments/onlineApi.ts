import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import type {Account,Counterparty,OpenDocument,Payment,PaymentDetail,PayrollBatch,PayrollComponent,PayrollEmployee,PayrollInput,PayrollManifest,PayrollRule,PayrollRun,PayrollRunDetail,PayrollWorkforcePerson,Payslip,StatutoryReturn,YearEndStatement} from "./types";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,path,init,c.onSession);
const json=(method:string,body?:unknown,headers:Record<string,string>={}):RequestInit=>({method,headers,body:body===undefined?undefined:JSON.stringify(body)});
const yes=(v:any)=>v===true||v===1||v==="1";
const employee=(x:any):PayrollEmployee=>({...x,id:String(x.id),employeeNumber:String(x.employeeNumber||""),name:String(x.name||x.employeeNumber||"Employee"),basePayMinor:Number(x.basePayMinor||0),active:yes(x.active)});
const run=(x:any):PayrollRun=>({...x,id:String(x.id),grossMinor:Number(x.grossMinor||0),deductionsMinor:Number(x.deductionsMinor||0),employerCostsMinor:Number(x.employerCostsMinor||0),netMinor:Number(x.netMinor||0)});
const component=(x:any):PayrollComponent=>({...x,id:String(x.id),rateMicros:x.rateMicros==null?null:Number(x.rateMicros),amountMinor:x.amountMinor==null?null:Number(x.amountMinor),taxable:yes(x.taxable),pensionable:yes(x.pensionable),statutory:yes(x.statutory),employerRateMicros:Number(x.employerRateMicros||0),active:yes(x.active)});

export const payrollPaymentsApi={
  payrollManifest:(c:Client)=>req<PayrollManifest>(c,"/payroll/manifest"),
  paymentsManifest:(c:Client)=>req<PayrollManifest>(c,"/payments/manifest"),
  workforce:(c:Client)=>req<PayrollWorkforcePerson[]>(c,"/payroll/workforce"),
  employees:async(c:Client)=>(await req<any[]>(c,"/payroll/employees")).map(employee),
  createEmployee:async(c:Client,body:any)=>employee(await req<any>(c,"/payroll/employees",json("POST",body))),
  runs:async(c:Client)=>(await req<any[]>(c,"/payroll/runs")).map(run),
  runDetail:async(c:Client,id:string)=>{const d=await req<any>(c,`/payroll/runs/${id}/lines`);return {run:run(d.run),lines:(d.lines||[]).map((x:any)=>({...x,grossMinor:Number(x.grossMinor||0),deductionsMinor:Number(x.deductionsMinor||0),employerCostsMinor:Number(x.employerCostsMinor||0),netMinor:Number(x.netMinor||0),paidMinor:Number(x.paidMinor||0),balanceMinor:Number(x.balanceMinor||0),components:Array.isArray(x.components)?x.components:[]}))} as PayrollRunDetail},
  calculateRun:(c:Client,body:any)=>req<any>(c,"/payroll/runs/calculate",json("POST",body)),
  approveRun:(c:Client,id:string)=>req<any>(c,`/payroll/runs/${id}/approve`,json("POST",{})),
  postRun:(c:Client,id:string,body:any)=>req<any>(c,`/payroll/runs/${id}/post`,json("POST",body)),
  reverseRun:(c:Client,id:string,postingDate:string,reason:string)=>req<any>(c,`/payroll/runs/${id}/reverse-safe`,json("POST",{postingDate,reason})),
  createBatch:(c:Client,runId:string,body:any)=>req<any>(c,`/payroll/runs/${runId}/payment-batches`,json("POST",body)),
  batches:(c:Client,runId?:string)=>req<PayrollBatch[]>(c,`/payroll/payment-batches${query({runId})}`),
  approveBatch:(c:Client,id:string)=>req<any>(c,`/payroll/payment-batches/${id}/approve`,json("POST",{})),
  processBatch:(c:Client,id:string,generalNetPayableAccountId?:string)=>req<any>(c,`/payroll/payment-batches/${id}/process-safe`,json("POST",{generalNetPayableAccountId:generalNetPayableAccountId||undefined})),
  payslip:(c:Client,runId:string,employeeId:string)=>req<Payslip>(c,`/payroll/runs/${runId}/payslips/${employeeId}`),
  deliverPayslip:(c:Client,runId:string,employeeId:string,channel:"email"|"portal",recipient:string)=>req<any>(c,`/payroll/runs/${runId}/payslips/${employeeId}/deliver`,json("POST",{channel,recipient})),
  components:async(c:Client)=>(await req<any[]>(c,"/payroll/components")).map(component),
  createComponent:async(c:Client,body:any)=>component(await req<any>(c,"/payroll/components",json("POST",body))),
  updateComponent:async(c:Client,id:string,body:any)=>component(await req<any>(c,`/payroll/components/${id}`,json("PATCH",body))),
  rules:(c:Client)=>req<PayrollRule[]>(c,"/payroll/rules"),
  createRule:(c:Client,body:any)=>req<any>(c,"/payroll/rules",json("POST",body)),
  updateRule:(c:Client,id:string,body:any)=>req<any>(c,`/payroll/rules/${id}`,json("PATCH",body)),
  inputs:(c:Client)=>req<PayrollInput[]>(c,"/payroll/inputs"),
  createInputs:(c:Client,body:any[])=>req<{created:number}>(c,"/payroll/inputs",json("POST",body)),
  yearEnd:(c:Client,year:string)=>req<YearEndStatement[]>(c,`/payroll/year-end/${encodeURIComponent(year)}/statements`),
  statutoryReturns:(c:Client,year?:string)=>req<StatutoryReturn[]>(c,`/payroll/statutory-returns${query({year})}`),
  createStatutoryReturn:(c:Client,body:any)=>req<any>(c,"/payroll/statutory-returns",json("POST",body)),
  setStatutoryReturnStatus:(c:Client,id:string,status:"draft"|"filed")=>req<any>(c,`/payroll/statutory-returns/${id}/status`,json("PATCH",{status})),
  accounts:async(c:Client)=>(await req<any[]>(c,"/accounts?limit=1000")).map((x:any)=>({...x,allowPosting:yes(x.allowPosting),active:yes(x.active)} as Account)),
  counterparties:(c:Client)=>req<Counterparty[]>(c,"/payments/counterparties"),
  payments:(c:Client)=>req<Payment[]>(c,"/payments?limit=250"),
  paymentDetail:(c:Client,id:string)=>req<PaymentDetail>(c,`/payments/${id}/details`),
  createPayment:(c:Client,body:any)=>req<any>(c,"/payments",json("POST",body,{"Idempotency-Key":`mobile-${Date.now()}-${Math.random().toString(36).slice(2,9)}`})),
  postPayment:(c:Client,id:string,allocations:Array<{documentId:string;amountMinor:number}>)=>req<any>(c,`/payments/${id}/post`,json("POST",{allocations})),
  allocatePayment:(c:Client,id:string,allocations:Array<{documentId:string;amountMinor:number}>)=>req<any>(c,`/payments/${id}/allocations`,json("POST",{allocations})),
  reversePayment:(c:Client,id:string,postingDate:string,reason:string)=>req<any>(c,`/payments/${id}/reverse-safe`,json("POST",{postingDate,reason})),
  deletePayment:(c:Client,id:string)=>req<void>(c,`/payments/${id}`,{method:"DELETE"}),
  openDocuments:(c:Client,contactId:string,paymentType:"receipt"|"payment")=>req<OpenDocument[]>(c,`/payments/counterparties/${contactId}/open-documents${query({paymentType})}`),
};
