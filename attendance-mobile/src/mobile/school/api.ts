import {schoolApi as baseSchoolApi} from "./baseApi";
import {withOfflineFallback} from "./offline";
import {offlineFeeBalances,offlineFeeCharges,offlineFeeDashboard,offlineFeePaymentMethods,offlineFeePlans,offlineFeeReceiptIntents,offlineFeeReceipts,offlineStudentStatement,queueFeeReceiptIntent} from "./offline-fees";

type R=Record<string,any>;

async function filteredBalances(params:R={}){
  let rows=await offlineFeeBalances();
  const q=String(params.q||params.search||"").trim().toLowerCase();
  if(q)rows=rows.filter((x:any)=>[x.studentName,x.admissionNumber,x.studentNumber].some(v=>String(v||"").toLowerCase().includes(q)));
  if(params.studentId)rows=rows.filter((x:any)=>x.studentId===params.studentId);
  if(params.currency)rows=rows.filter((x:any)=>String(x.currency||"").toUpperCase()===String(params.currency).toUpperCase());
  if(params.outstandingOnly)rows=rows.filter((x:any)=>Number(x.balanceMinor||0)>0);
  const offset=Math.max(0,Number(params.offset||0)),limit=Math.max(1,Math.min(1000,Number(params.limit||200)));
  return rows.slice(offset,offset+limit);
}

export const schoolApi={
  ...baseSchoolApi,
  feeDashboard:(c:any,params:R={})=>withOfflineFallback(()=>baseSchoolApi.feeDashboard(c,params),offlineFeeDashboard),
  feeBalances:(c:any,params:R={})=>withOfflineFallback(()=>baseSchoolApi.feeBalances(c,params),()=>filteredBalances(params)),
  studentStatement:(c:any,id:string,params:R={})=>withOfflineFallback(()=>baseSchoolApi.studentStatement(c,id,params),()=>offlineStudentStatement(id)),
  feePaymentMethodsOffline:()=>offlineFeePaymentMethods(),
  feeChargesOffline:()=>offlineFeeCharges(),
  feeReceiptsOffline:()=>offlineFeeReceipts(),
  feePaymentPlansOffline:()=>offlineFeePlans(),
  feeReceiptIntentsOffline:()=>offlineFeeReceiptIntents(),
  captureFeeReceiptIntent:(_c:any,body:R)=>queueFeeReceiptIntent(body),
};
