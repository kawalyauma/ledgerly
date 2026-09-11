import { createHash } from 'node:crypto';

function requireText(value,name){if(typeof value!=='string'||value.trim()==='')throw new TypeError(`${name} is required`);return value.trim();}
function safeId(value){const id=requireText(value,'id');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))throw Object.assign(new Error('attachment id contains unsupported characters'),{code:'ATTACHMENT_INVALID_ID',status:400});return id;}
function safeName(value){const name=requireText(value,'originalName').replaceAll('\\','/').split('/').at(-1);if(!name||name==='.'||name==='..')throw Object.assign(new Error('invalid attachment name'),{code:'ATTACHMENT_INVALID_NAME',status:400});return name.slice(0,255);}
function asBytes(value){if(Buffer.isBuffer(value))return value;if(value instanceof Uint8Array)return Buffer.from(value);throw new TypeError('bytes must be a Buffer or Uint8Array');}
function actorId(actor){return requireText(actor?.actorId,'actor.actorId');}

export class AttachmentsService {
  constructor({repository,tenantStorage,audit=null,maxBytes=25*1024*1024}){
    if(!repository||!tenantStorage?.forOrganization)throw new TypeError('attachments service requires repository and tenantStorage');
    this.repository=repository;this.tenantStorage=tenantStorage;this.audit=audit;this.maxBytes=Math.max(1,Number(maxBytes)||25*1024*1024);
  }
  async upload({organizationId,actor,id,originalName,mimeType='application/octet-stream',purpose='attachment',entityType=null,entityId=null,bytes}){
    const organization=requireText(organizationId,'organizationId'); const attachmentId=safeId(id); const content=asBytes(bytes);
    if(content.length>this.maxBytes)throw Object.assign(new Error('attachment exceeds configured size limit'),{code:'ATTACHMENT_TOO_LARGE',status:413});
    const checksum=createHash('sha256').update(content).digest('hex'); const objectKey=`attachments/${encodeURIComponent(attachmentId)}`; const storage=this.tenantStorage.forOrganization(organization);
    const existing=await this.repository.get(organization,attachmentId,{includeDeleted:true});
    if(existing){if(existing.checksum_sha256===checksum&&Number(existing.size_bytes)===content.length&&existing.storage_state==='active')return {...existing,duplicate:true};throw Object.assign(new Error('attachment id already exists with different content or state'),{code:'ATTACHMENT_IDEMPOTENCY_MISMATCH',status:409});}
    await storage.put(objectKey,content,{contentType:requireText(mimeType,'mimeType'),custom:{attachmentId,checksumSha256:checksum}});
    let row;
    try {row=await this.repository.insert({id:attachmentId,organizationId:organization,objectKey,originalName:safeName(originalName),mimeType:requireText(mimeType,'mimeType'),sizeBytes:content.length,checksumSha256:checksum,purpose:requireText(purpose,'purpose'),entityType:entityType?requireText(entityType,'entityType'):null,entityId:entityId?requireText(entityId,'entityId'):null,uploadedBy:actorId(actor)});} catch(error){await storage.delete(objectKey).catch(()=>undefined);throw error;}
    await this.audit?.write({organizationId:organization,actorType:actor?.actorType??'human',actorId:actorId(actor),action:'attachment.upload',entityType:'shared_attachment',entityId:attachmentId,after:row,metadata:{purpose:row.purpose,sizeBytes:content.length,checksumSha256:checksum}});
    return row;
  }
  async get({organizationId,id}){return this.repository.get(requireText(organizationId,'organizationId'),safeId(id));}
  async list(input){return this.repository.list({...input,organizationId:requireText(input.organizationId,'organizationId')});}
  async createDownloadUrl({organizationId,id,expiresSeconds=900}){const organization=requireText(organizationId,'organizationId');const row=await this.repository.get(organization,safeId(id));if(!row)throw Object.assign(new Error('attachment not found'),{code:'ATTACHMENT_NOT_FOUND',status:404});const url=await this.tenantStorage.forOrganization(organization).createDownloadUrl(row.object_key,{expiresSeconds:Math.max(1,Math.min(Number(expiresSeconds)||900,3600))});return {attachment:row,url,expiresSeconds:Math.max(1,Math.min(Number(expiresSeconds)||900,3600))};}
  async delete({organizationId,actor,id}){const organization=requireText(organizationId,'organizationId');const attachmentId=safeId(id);const pending=await this.repository.markDeletePending(organization,attachmentId);if(!pending){const prior=await this.repository.get(organization,attachmentId,{includeDeleted:true});if(prior?.storage_state==='deleted')return {...prior,duplicate:true};throw Object.assign(new Error('attachment not found'),{code:'ATTACHMENT_NOT_FOUND',status:404});}
    await this.tenantStorage.forOrganization(organization).delete(pending.object_key);const row=await this.repository.finalizeDelete(organization,attachmentId);if(!row)throw Object.assign(new Error('attachment delete could not be finalized'),{code:'ATTACHMENT_DELETE_FINALIZE_FAILED',status:503});
    await this.audit?.write({organizationId:organization,actorType:actor?.actorType??'human',actorId:actorId(actor),action:'attachment.delete',entityType:'shared_attachment',entityId:attachmentId,before:pending,after:row});return row;}
}
