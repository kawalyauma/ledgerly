import { AppError } from "../../../src/lib/errors";
import { createDocument } from "../../../src/services/documents";
import { createJournal } from "../../../src/services/ledger";

type IntentRow={id:string;organizationId:string;deviceId:string|null;payload:string;createdBy:string;attempts:number};
function retryDelay(attempts:number){return Math.min(24*60,Math.max(1,2**Math.min(attempts,10)));}
async function markFailure(db:D1Database,table:string,row:IntentRow,error:unknown){
  const terminal=error instanceof AppError && error.status<500;const attempts=Number(row.attempts||0)+1;const code=error instanceof AppError?error.code:"PROCESSING_ERROR";const message=error instanceof Error?error.message:String(error);
  if(terminal||attempts>=10)await db.prepare(`UPDATE ${table} SET status='rejected',attempts=?,error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(attempts,code,message.slice(0,1000),row.id,row.organizationId).run();
  else await db.prepare(`UPDATE ${table} SET status='retry',attempts=?,error_code=?,error_message=?,next_attempt_at=datetime(CURRENT_TIMESTAMP,?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(attempts,code,message.slice(0,1000),`+${retryDelay(attempts)} minutes`,row.id,row.organizationId).run();
}
async function processDocument(db:D1Database,row:IntentRow){
  const claimed=await db.prepare(`UPDATE ledgerly_mobile_document_intents SET status='processing',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status IN ('pending','retry')`).bind(row.id,row.organizationId).run();if(!claimed.meta.changes)return;
  try{
    const existing=await db.prepare(`SELECT id FROM documents WHERE organization_id=? AND json_extract(custom_fields,'$.mobileIntentId')=? LIMIT 1`).bind(row.organizationId,row.id).first<{id:string}>();
    let documentId=existing?.id;
    if(!documentId){const payload=JSON.parse(row.payload);const doc=await createDocument(db,row.organizationId,row.createdBy,{...payload,customFields:{...(payload.customFields||{}),mobileIntentId:row.id,mobileDeviceId:row.deviceId,mobileOrigin:"offline"}});documentId=doc.id;}
    await db.prepare(`UPDATE ledgerly_mobile_document_intents SET status='applied',server_document_id=?,error_code=NULL,error_message=NULL,next_attempt_at=NULL,applied_at=COALESCE(applied_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(documentId,row.id,row.organizationId).run();
  }catch(error){await markFailure(db,"ledgerly_mobile_document_intents",row,error);}
}
async function processJournal(db:D1Database,row:IntentRow){
  const claimed=await db.prepare(`UPDATE ledgerly_mobile_journal_intents SET status='processing',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status IN ('pending','retry')`).bind(row.id,row.organizationId).run();if(!claimed.meta.changes)return;
  try{const payload=JSON.parse(row.payload);const journal=await createJournal(db,row.organizationId,row.createdBy,{...payload,sourceType:"mobile_offline",sourceId:row.id},`mobile-finance-intent:${row.id}`);await db.prepare(`UPDATE ledgerly_mobile_journal_intents SET status='applied',server_journal_id=?,error_code=NULL,error_message=NULL,next_attempt_at=NULL,applied_at=COALESCE(applied_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(journal.id,row.id,row.organizationId).run();}
  catch(error){await markFailure(db,"ledgerly_mobile_journal_intents",row,error);}
}
export async function processPendingFinanceMobileIntents(db:D1Database,options:{limit?:number;organizationId?:string}={}){
  const recoveryWhere=options.organizationId?" AND organization_id=?":"";
  const recoveryArgs=options.organizationId?[options.organizationId]:[];
  await db.prepare(`UPDATE ledgerly_mobile_document_intents SET status='retry',next_attempt_at=CURRENT_TIMESTAMP,error_code=COALESCE(error_code,'PROCESS_INTERRUPTED'),error_message=COALESCE(error_message,'Recovered after an interrupted server conversion'),updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND updated_at<datetime('now','-10 minutes')${recoveryWhere}`).bind(...recoveryArgs).run();
  await db.prepare(`UPDATE ledgerly_mobile_journal_intents SET status='retry',next_attempt_at=CURRENT_TIMESTAMP,error_code=COALESCE(error_code,'PROCESS_INTERRUPTED'),error_message=COALESCE(error_message,'Recovered after an interrupted server conversion'),updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND updated_at<datetime('now','-10 minutes')${recoveryWhere}`).bind(...recoveryArgs).run();
  const limit=Math.min(Math.max(options.limit||25,1),100),filter=options.organizationId?"AND organization_id=?":"",args=options.organizationId?[options.organizationId,limit]:[limit];
  const documents=await db.prepare(`SELECT id,organization_id AS organizationId,device_id AS deviceId,payload_json AS payload,created_by AS createdBy,attempts FROM ledgerly_mobile_document_intents WHERE status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ${filter} ORDER BY created_at LIMIT ?`).bind(...args).all<IntentRow>();
  for(const row of documents.results)await processDocument(db,row);
  const remaining=Math.max(0,limit-documents.results.length);if(!remaining)return{documents:documents.results.length,journals:0};
  const jArgs=options.organizationId?[options.organizationId,remaining]:[remaining];const journals=await db.prepare(`SELECT id,organization_id AS organizationId,device_id AS deviceId,payload_json AS payload,created_by AS createdBy,attempts FROM ledgerly_mobile_journal_intents WHERE status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ${filter} ORDER BY created_at LIMIT ?`).bind(...jArgs).all<IntentRow>();
  for(const row of journals.results)await processJournal(db,row);return{documents:documents.results.length,journals:journals.results.length};
}
