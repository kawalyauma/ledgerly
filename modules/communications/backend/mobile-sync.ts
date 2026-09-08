import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import type { MobileSyncMutation, MobileSyncMutationContext, PreparedMobileSyncMutation } from "../../mobile-sync/backend/contracts";
import { registerMobileSyncCollection } from "../../mobile-sync/backend/registry";
import { requireCommunicationsRead, requireCommunicationsSend } from "./mobile-sync-permissions";
import { snapshotCampaigns, snapshotDeliveries, snapshotMessageTypes, snapshotRecipients } from "./mobile-sync-snapshots";

const draft=z.object({typeKey:z.string().min(1).max(80),name:z.string().min(1).max(160).optional(),senderName:z.string().min(1).max(160).optional(),subject:z.string().min(1).max(200).optional(),message:z.string().min(1).max(2000).optional(),channels:z.array(z.enum(["sms","whatsapp"])).min(1).max(2),audience:z.record(z.string(),z.unknown())}).strict();
async function prepareDraft(c:MobileSyncMutationContext,m:MobileSyncMutation):Promise<PreparedMobileSyncMutation>{
  await requireCommunicationsSend(c);
  if(m.kind==='delete')throw new AppError(409,'APPEND_ONLY_COLLECTION','Offline campaign drafts cannot be deleted');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,149}$/.test(m.recordId))throw new AppError(422,'INVALID_CAMPAIGN_ID','Campaign draft IDs must be stable UUID-style identifiers');
  const p=draft.safeParse(m.payload);if(!p.success)throw new AppError(422,'VALIDATION_ERROR','Invalid offline campaign draft',p.error.flatten());
  if(await c.db.prepare('SELECT 1 FROM communication_campaigns WHERE id=? AND organization_id=?').bind(m.recordId,c.organizationId).first())throw new AppError(409,'CAMPAIGN_ID_EXISTS','This campaign draft already exists');
  const type=await c.db.prepare('SELECT * FROM communication_message_types WHERE organization_id=? AND type_key=? AND active=1').bind(c.organizationId,p.data.typeKey).first<any>();if(!type)throw new AppError(404,'MESSAGE_TYPE_NOT_FOUND','Message type not found or is no longer active');
  const org=await c.db.prepare('SELECT name FROM organizations WHERE id=?').bind(c.organizationId).first<{name:string}>();
  const audience={...JSON.parse(type.audience_defaults_json||'{}'),...p.data.audience,kind:String(p.data.audience.kind||type.audience_kind)};
  const channels=[...new Set(p.data.channels)];
  const statement=c.db.prepare(`INSERT INTO communication_campaigns(id,organization_id,message_type_id,type_key,module_key,name,sender_name,subject_template,message_template,channels_json,audience_kind,audience_json,status,scheduled_at,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'draft',NULL,?,?,?,?)`).bind(m.recordId,c.organizationId,type.id,type.type_key,type.module_key,p.data.name||type.name,p.data.senderName||org?.name||'Ledgerly',p.data.subject||type.subject_template,p.data.message||type.message_template,JSON.stringify(channels),audience.kind,JSON.stringify(audience),c.userId,c.userId,m.clientTimestamp,m.clientTimestamp);
  return{statements:[statement],serverPayload:{id:m.recordId,typeKey:type.type_key,name:p.data.name||type.name,channels,audience,status:'draft',createdAt:m.clientTimestamp},result:{campaignId:m.recordId,status:'draft',requiresOnlineSend:true}};
}
const read={pullScope:'communications:read',authorizePull:requireCommunicationsRead} as const;
registerMobileSyncCollection({moduleKey:'communications',collectionKey:'message-types',schemaVersion:1,mode:'read-only',sourceOfTruth:'server',conflictPolicy:'server-wins',...read,snapshot:snapshotMessageTypes});
registerMobileSyncCollection({moduleKey:'communications',collectionKey:'campaigns',schemaVersion:1,mode:'read-only',sourceOfTruth:'server',conflictPolicy:'server-wins',...read,snapshot:snapshotCampaigns});
registerMobileSyncCollection({moduleKey:'communications',collectionKey:'recipients',schemaVersion:1,mode:'read-only',sourceOfTruth:'server',conflictPolicy:'server-wins',...read,snapshot:snapshotRecipients});
registerMobileSyncCollection({moduleKey:'communications',collectionKey:'deliveries',schemaVersion:1,mode:'read-only',sourceOfTruth:'server',conflictPolicy:'server-wins',...read,snapshot:snapshotDeliveries});
registerMobileSyncCollection({moduleKey:'communications',collectionKey:'campaign-drafts',schemaVersion:1,mode:'append-only',sourceOfTruth:'merge',conflictPolicy:'append-only',pullScope:'communications:read',authorizePull:requireCommunicationsRead,pushScope:'communications:write',authorizePush:requireCommunicationsSend,prepareMutation:prepareDraft,snapshot:async()=>[]});
