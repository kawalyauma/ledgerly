import {createHash,randomUUID} from 'node:crypto';
import {tenantStorageKey} from '../contracts.mjs';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const MAX_DOCUMENT_BYTES=50*1024*1024;
const PRINTABLE_MIME=new Set(['application/pdf','image/jpeg','image/png','text/plain']);
const id=p=>`${p}_${randomUUID().replaceAll('-','')}`;
const safeName=name=>{const clean=String(name||'document').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');return(clean||'document').slice(0,180);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function readPrinterlyMultipartFile(request,{limit=MAX_DOCUMENT_BYTES+1024*1024}={}){
  const contentType=String(request.headers?.['content-type']||request.headers?.get?.('content-type')||'');
  const match=/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);if(!match)throw Object.assign(new PrinterlyRuntimeError('MULTIPART_REQUIRED','Printerly document upload must use multipart/form-data'),{status:415});
  const boundary=Buffer.from(`--${match[1]||match[2]}`),chunks=[];let total=0;for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=bytes.length;if(total>limit)throw Object.assign(new PrinterlyRuntimeError('FILE_TOO_LARGE','Printerly documents are limited to 50 MB'),{status:413});chunks.push(bytes);}
  const body=Buffer.concat(chunks);let cursor=0;while(true){const start=body.indexOf(boundary,cursor);if(start<0)break;let headStart=start+boundary.length;if(body.subarray(headStart,headStart+2).toString()==='--')break;if(body.subarray(headStart,headStart+2).toString()==='\r\n')headStart+=2;const headerEnd=body.indexOf(Buffer.from('\r\n\r\n'),headStart);if(headerEnd<0)break;const headers=body.subarray(headStart,headerEnd).toString('utf8'),next=body.indexOf(boundary,headerEnd+4);if(next<0)break;const disposition=/content-disposition:\s*form-data;[^\r\n]*name="([^"]+)"(?:;[^\r\n]*filename="([^"]*)")?/i.exec(headers);if(disposition?.[1]==='file'&&disposition[2]!=null){let end=next;if(body.subarray(end-2,end).toString()==='\r\n')end-=2;const bytes=body.subarray(headerEnd+4,end),mime=(/content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]||'application/octet-stream').trim().toLowerCase();return{name:disposition[2],mime,bytes};}cursor=next;}
  throw Object.assign(new PrinterlyRuntimeError('FILE_REQUIRED','Choose a document to print'),{status:422});
}

export class PrinterlyDocumentService{
  constructor({database,storage}){if(!database?.query||!database?.transaction)throw new TypeError('database is required');if(!storage?.put||!storage?.delete)throw new TypeError('storage is required');this.database=database;this.storage=storage;}
  async upload({organizationId,userId,file}){
    const bytes=Buffer.from(file?.bytes||[]);if(!bytes.length)throw Object.assign(new PrinterlyRuntimeError('EMPTY_FILE','The selected document is empty'),{status:422});if(bytes.length>MAX_DOCUMENT_BYTES)throw Object.assign(new PrinterlyRuntimeError('FILE_TOO_LARGE','Printerly documents are limited to 50 MB'),{status:413});const mime=String(file?.mime||'application/octet-stream').toLowerCase();if(!PRINTABLE_MIME.has(mime))throw Object.assign(new PrinterlyRuntimeError('UNSUPPORTED_PRINT_FILE','Printerly currently accepts PDF, PNG, JPEG and plain-text documents. Convert Word/Excel files to PDF before printing.'),{status:415});
    const documentId=id('prndoc'),created=new Date().toISOString(),name=safeName(file.name),logicalKey=`printerly/${organizationId}/${created.slice(0,7)}/${documentId}/${name}`,physicalKey=tenantStorageKey(organizationId,logicalKey),checksum=digest(bytes);
    await this.storage.put(physicalKey,bytes,{contentType:mime,custom:{organizationId,documentId,checksum,originalName:String(file.name||name)}});
    try{await this.database.query(`INSERT INTO prn_documents(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,status,uploaded_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'staged',$8,$9)`,[documentId,organizationId,logicalKey,String(file.name||name),mime,bytes.length,checksum,userId,created]);}catch(error){await this.storage.delete(physicalKey).catch(()=>{});throw error;}
    return{id:documentId,originalName:String(file.name||name),mimeType:mime,sizeBytes:bytes.length,checksum};
  }
  async remove({organizationId,documentId}){
    const doc=await this.database.transaction(async tx=>{const row=(await tx.query(`SELECT id,object_key,status FROM prn_documents WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];if(!row)throw Object.assign(new PrinterlyRuntimeError('DOCUMENT_NOT_FOUND','Printerly document not found'),{status:404});if(row.status!=='staged')throw new PrinterlyRuntimeError('DOCUMENT_IN_USE','This document is already attached to a print job');const moved=await tx.query(`UPDATE prn_documents SET status='deleted',deleted_at=now() WHERE id=$1 AND organization_id=$2 AND status='staged'`,[documentId,organizationId]);if(moved.rowCount!==1)throw new PrinterlyRuntimeError('DOCUMENT_RACE','Printerly document changed before deletion');return row;});
    const key=tenantStorageKey(organizationId,doc.object_key);try{await this.storage.delete(key);}catch(error){await this.database.query(`UPDATE prn_documents SET status='staged',deleted_at=NULL WHERE id=$1 AND organization_id=$2 AND status='deleted'`,[documentId,organizationId]).catch(()=>{});throw error;}return{id:documentId,deleted:true};
  }
}

export {MAX_DOCUMENT_BYTES,PRINTABLE_MIME};
