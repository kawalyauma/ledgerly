export const FINANCE_JOB_TYPES=Object.freeze({
  PDF:'document.pdf',REPORT_CARD:'school.report-card',BULK_EXPORT:'bulk.export',BULK_IMPORT:'bulk.import',EMAIL:'notification.email',SMS:'notification.sms',WHATSAPP:'notification.whatsapp',PAYROLL:'payroll.process',FINANCIAL_REPORT:'finance.report',BACKUP:'system.backup',SCHOOL_REPORT:'school.report',PRINTERLY:'printerly.print'
});
const expensive=new Set(Object.values(FINANCE_JOB_TYPES));
export function createJobEnvelope({jobId,type,organizationId,idempotencyKey,payload={},actor=null}){
  if(!expensive.has(type))throw new TypeError(`Unsupported job type: ${type}`);
  if(!jobId||!organizationId||!idempotencyKey)throw new TypeError('jobId, organizationId and idempotencyKey are required');
  return Object.freeze({jobId:String(jobId),type,organizationId:String(organizationId),idempotencyKey:String(idempotencyKey),payload,actor,attempt:0,createdAt:new Date().toISOString()});
}
export async function runQueuedJob({queue,handlers}){
  const item=await queue.take();if(!item)return null;
  const handler=handlers[item.job.type];if(!handler){await queue.deadLetter(item.receipt,{reason:'unregistered_job_type'});return{deadLettered:true,jobId:item.job.jobId};}
  try{const result=await handler(item.job);await queue.ack(item.receipt);return{ok:true,jobId:item.job.jobId,result};}
  catch(error){return queue.retry(item.receipt,{reason:error instanceof Error?error.message:String(error)});}
}
