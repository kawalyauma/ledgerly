import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import type { MobileSyncMutation, MobileSyncMutationContext, PreparedMobileSyncMutation } from "../../mobile-sync/backend/contracts";

const documentLine=z.object({productId:z.string().optional(),accountId:z.string().min(1),taxAccountId:z.string().optional(),description:z.string().min(1).max(500),quantityMicros:z.number().int().positive().default(1_000_000),unitPriceMinor:z.number().int().nonnegative(),taxMinor:z.number().int().nonnegative().default(0),projectId:z.string().optional(),classId:z.string().optional(),departmentId:z.string().optional(),locationId:z.string().optional(),dimensions:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional()});
const documentIntent=z.object({type:z.enum(["invoice","bill"]),number:z.string().min(1).max(60),contactId:z.string().min(1),issueDate:z.iso.date(),dueDate:z.iso.date().optional(),currency:z.string().length(3).toUpperCase(),customFields:z.record(z.string(),z.unknown()).optional(),lines:z.array(documentLine).min(1).max(500)});
const journalLine=z.object({accountId:z.string().min(1),description:z.string().max(500).optional(),debitMinor:z.number().int().nonnegative().optional(),creditMinor:z.number().int().nonnegative().optional(),contactId:z.string().optional(),projectId:z.string().optional(),classId:z.string().optional(),departmentId:z.string().optional(),locationId:z.string().optional(),taxCode:z.string().max(30).optional(),dimensions:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional()});
const journalIntent=z.object({transactionDate:z.iso.date(),postingDate:z.iso.date(),description:z.string().min(1).max(500),reference:z.string().max(100).optional(),currency:z.string().length(3).toUpperCase(),exchangeRateMicros:z.number().int().positive().optional(),lines:z.array(journalLine).min(2).max(500)});

function ensureAppend(m:MobileSyncMutation){if(m.kind!=="upsert")throw new AppError(409,"OFFLINE_FINANCE_APPEND_ONLY","Offline finance intents are immutable and cannot be deleted or edited");}
export async function prepareDocumentIntent(c:MobileSyncMutationContext,m:MobileSyncMutation):Promise<PreparedMobileSyncMutation>{
  ensureAppend(m);const parsed=documentIntent.safeParse(m.payload);if(!parsed.success)throw new AppError(422,"INVALID_FINANCE_DOCUMENT_INTENT","Invalid offline invoice/bill intent",parsed.error.flatten());
  const p=parsed.data;
  return{statements:[c.db.prepare(`INSERT INTO ledgerly_mobile_document_intents (id,organization_id,device_id,intent_type,payload_json,status,created_by,client_created_at) VALUES (?,?,?,?,?,'pending',?,?)`).bind(m.recordId,c.organizationId,c.deviceId,p.type,JSON.stringify(p),c.userId,m.clientTimestamp)],serverPayload:{id:m.recordId,intentType:p.type,status:"pending",clientCreatedAt:m.clientTimestamp},result:{queued:true,status:"pending"}};
}
export async function prepareJournalIntent(c:MobileSyncMutationContext,m:MobileSyncMutation):Promise<PreparedMobileSyncMutation>{
  ensureAppend(m);const parsed=journalIntent.safeParse(m.payload);if(!parsed.success)throw new AppError(422,"INVALID_FINANCE_JOURNAL_INTENT","Invalid offline manual journal intent",parsed.error.flatten());
  const debit=parsed.data.lines.reduce((n,l)=>n+(l.debitMinor||0),0),credit=parsed.data.lines.reduce((n,l)=>n+(l.creditMinor||0),0);if(debit<=0||debit!==credit)throw new AppError(422,"UNBALANCED_JOURNAL","Offline journal intent must balance before it can be queued");
  return{statements:[c.db.prepare(`INSERT INTO ledgerly_mobile_journal_intents (id,organization_id,device_id,payload_json,status,created_by,client_created_at) VALUES (?,?,?,?,'pending',?,?)`).bind(m.recordId,c.organizationId,c.deviceId,JSON.stringify(parsed.data),c.userId,m.clientTimestamp)],serverPayload:{id:m.recordId,status:"pending",clientCreatedAt:m.clientTimestamp},result:{queued:true,status:"pending"}};
}
