import {createHash,randomBytes,randomInt,randomUUID} from 'node:crypto';
import {tenantStorageKey} from '../contracts.mjs';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const makeId=p=>`${p}_${randomUUID().replaceAll('-','')}`;
const token=()=>randomBytes(48).toString('base64url');
const now=()=>new Date().toISOString();
const fail=(code,message,status=409)=>Object.assign(new PrinterlyRuntimeError(code,message),{status});

export class PrinterlyNodeService{
  constructor({database,storage,runtime,costing}){if(!database?.query||!database?.transaction)throw new TypeError('database is required');if(!storage?.get)throw new TypeError('raw storage is required');this.database=database;this.storage=storage;this.runtime=runtime;this.costing=costing;}

  async pair(data){
    const code=String(data?.pairingCode||'').replace(/\s/g,'');if(!/^\d{6}$/.test(code))throw fail('VALIDATION_ERROR','Enter the six-digit pairing code',422);
    return this.database.transaction(async tx=>{
      const node=(await tx.query(`SELECT * FROM prn_nodes WHERE pairing_code_hash=$1 AND revoked_at IS NULL FOR UPDATE`,[digest(code)])).rows[0];
      if(!node||!node.pairing_expires_at||Date.parse(node.pairing_expires_at)<=Date.now())throw fail('PAIRING_INVALID','Pairing code is invalid or expired',401);
      const clear=token();await tx.query(`UPDATE prn_nodes SET token_hash=$1,pairing_code_hash=NULL,pairing_expires_at=NULL,status='online',last_seen_at=now(),version=$2,updated_at=now() WHERE id=$3`,[digest(clear),String(data?.version||'1.2.0'),node.id]);
      return{nodeId:node.id,organizationId:node.organization_id,nodeToken:clear,name:node.name};
    });
  }
  async authenticate(bearer){
    if(!bearer)throw fail('NODE_UNAUTHORIZED','Missing Printerly node token',401);
    const node=(await this.database.query(`SELECT * FROM prn_nodes WHERE token_hash=$1 AND revoked_at IS NULL`,[digest(bearer)])).rows[0];if(!node)throw fail('NODE_UNAUTHORIZED','Invalid Printerly node token',401);return node;
  }
  async heartbeat(node,data={}){
    const printers=Array.isArray(data.printers)?data.printers:[],scanners=Array.isArray(data.scanners)?data.scanners:[];
    return this.database.transaction(async tx=>{
      await tx.query(`UPDATE prn_nodes SET status='online',last_seen_at=now(),version=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[String(data.version||node.version||''),node.id,node.organization_id]);
      const printerNames=[];
      for(const p of printers){const systemName=String(p.systemName||p.id||p.name||'').trim();if(!systemName)continue;printerNames.push(systemName);const health=p.health||{};
        await tx.query(`INSERT INTO prn_printers(id,organization_id,node_id,name,system_name,location,status,capabilities_json,last_seen_at,health_status,state_reasons_json,marker_levels_json,health_message,last_health_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10,$11,$12,now()) ON CONFLICT(node_id,system_name) DO UPDATE SET name=excluded.name,location=excluded.location,status=excluded.status,capabilities_json=excluded.capabilities_json,last_seen_at=now(),health_status=excluded.health_status,state_reasons_json=excluded.state_reasons_json,marker_levels_json=excluded.marker_levels_json,health_message=excluded.health_message,last_health_at=now(),updated_at=now()`,[makeId('prnp'),node.organization_id,node.id,String(p.name||systemName),systemName,String(p.location||node.location||''),String(p.status||'ready'),JSON.stringify(p.capabilities||{}),health.reasons?.length?'warning':String(p.status||'ready')==='ready'?'healthy':'offline',JSON.stringify(health.reasons||[]),JSON.stringify(health.markers||[]),String(health.message||'')]);
      }
      if(printerNames.length)await tx.query(`UPDATE prn_printers SET status='offline',updated_at=now() WHERE organization_id=$1 AND node_id=$2 AND NOT(system_name=ANY($3::text[]))`,[node.organization_id,node.id,printerNames]);else await tx.query(`UPDATE prn_printers SET status='offline',updated_at=now() WHERE organization_id=$1 AND node_id=$2`,[node.organization_id,node.id]);
      const scannerNames=[];
      for(const s of scanners){const systemName=String(s.systemName||s.id||s.name||'').trim();if(!systemName)continue;scannerNames.push(systemName);await tx.query(`INSERT INTO prn_scanners(id,organization_id,node_id,name,system_name,status,capabilities_json,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(node_id,system_name) DO UPDATE SET name=excluded.name,status=excluded.status,capabilities_json=excluded.capabilities_json,last_seen_at=now(),updated_at=now()`,[makeId('prnscan'),node.organization_id,node.id,String(s.name||systemName),systemName,String(s.status||'ready'),JSON.stringify(s.capabilities||{})]);}
      if(scannerNames.length)await tx.query(`UPDATE prn_scanners SET status='offline',updated_at=now() WHERE organization_id=$1 AND node_id=$2 AND NOT(system_name=ANY($3::text[]))`,[node.organization_id,node.id,scannerNames]);else await tx.query(`UPDATE prn_scanners SET status='offline',updated_at=now() WHERE organization_id=$1 AND node_id=$2`,[node.organization_id,node.id]);
      return{ok:true,serverTime:now(),nodeProtocol:3};
    });
  }
  async claim(node,data={}){
    const names=(Array.isArray(data.printerSystemNames)?data.printerSystemNames:[]).map(String).filter(Boolean);if(!names.length)return null;
    const printers=(await this.database.query(`SELECT id,system_name FROM prn_printers WHERE organization_id=$1 AND node_id=$2 AND status='ready' AND system_name=ANY($3::text[])`,[node.organization_id,node.id,names])).rows;if(!printers.length)return null;
    const claimed=await this.runtime.claimForNode({organizationId:node.organization_id,nodeId:node.id,printerIds:printers.map(p=>p.id)});if(!claimed)return null;
    const job=(await this.database.query(`SELECT j.*,p.system_name printer_system_name FROM prn_jobs j JOIN prn_printers p ON p.id=j.printer_id AND p.organization_id=j.organization_id WHERE j.id=$1 AND j.organization_id=$2`,[claimed.id,node.organization_id])).rows[0];
    return{...job,claim_token:claimed.claimToken,printer_system_name:job.printer_system_name};
  }
  async document(node,jobId,claimToken){
    const row=(await this.database.query(`SELECT j.claim_token,j.status,d.object_key,d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256 FROM prn_jobs j JOIN prn_documents d ON d.id=j.document_id AND d.organization_id=j.organization_id WHERE j.id=$1 AND j.organization_id=$2 AND j.node_id=$3`,[jobId,node.organization_id,node.id])).rows[0];
    if(!row||row.claim_token!==claimToken||!['claimed','downloading','spooling','printing'].includes(row.status))throw fail('CLAIM_INVALID','Job claim is no longer valid',401);
    const migrated=(await this.database.query(`SELECT target_key FROM ledgerly_meta.object_migration_state WHERE object_key=$1 AND organization_id=$2 AND status='verified' ORDER BY migrated_at DESC LIMIT 1`,[row.object_key,node.organization_id])).rows[0];
    const physicalKey=migrated?.target_key||tenantStorageKey(node.organization_id,row.object_key);const prefix=`org/${encodeURIComponent(node.organization_id)}/`;if(!physicalKey.startsWith(prefix))throw fail('STORAGE_SCOPE_INVALID','Printerly document is outside the node organization',403);
    let bytes;try{bytes=await this.storage.get(physicalKey)}catch{throw fail('DOCUMENT_NOT_FOUND','Printerly document content is not available on self-hosted storage',404)}
    const actual=digest(bytes);if(actual!==row.checksum_sha256)throw fail('DOCUMENT_CHECKSUM_MISMATCH','Printerly document checksum validation failed',409);
    return{bytes,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),originalName:row.original_name,checksum:actual};
  }
  async status(node,jobId,data={}){
    const status=String(data.status||'');
    if(status==='completed')return this.costing.completeClaimedJob({organizationId:node.organization_id,nodeId:node.id,jobId,claimToken:String(data.claimToken||''),impressionsCompleted:data.impressionsCompleted, sheetsCompleted:data.sheetsCompleted});
    return this.runtime.nodeTransition({organizationId:node.organization_id,nodeId:node.id,jobId,claimToken:String(data.claimToken||''),status,errorMessage:data.errorMessage||null});
  }
  async redeem(node,data={}){
    let value=String(data.credential||data.pin||data.token||'').trim();if(value.startsWith('printerly-release:'))value=value.slice('printerly-release:'.length);if(!value)throw fail('INVALID_RELEASE_CREDENTIAL','Enter a valid release PIN or scan the job QR code');
    const recent=(await this.database.query(`SELECT COUNT(*)::int count FROM prn_release_attempt_log WHERE organization_id=$1 AND node_id=$2 AND success=false AND created_at>now()-interval '10 minutes'`,[node.organization_id,node.id])).rows[0];if(Number(recent?.count||0)>=20)throw fail('RELEASE_THROTTLED','Too many failed release attempts. Wait before trying again.',429);
    const hash=digest(value),isPin=/^\d{6}$/.test(value);
    return this.database.transaction(async tx=>{
      const c=(await tx.query(`SELECT r.*,j.status job_status,j.secure_release,j.printer_id,j.route_pool_id,j.job_number,j.title FROM prn_release_credentials r JOIN prn_jobs j ON j.id=r.job_id AND j.organization_id=r.organization_id WHERE r.organization_id=$1 AND ${isPin?'r.pin_digest':'r.token_digest'}=$2 ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF r`,[node.organization_id,hash])).rows[0];
      if(!c||c.used_at||c.revoked_at||c.locked_at||Date.parse(c.expires_at)<=Date.now()||c.job_status!=='held'||!c.secure_release){if(c)await this.#releaseFailure(tx,node,c,'INVALID_RELEASE_CREDENTIAL');else await tx.query(`INSERT INTO prn_release_attempt_log(id,organization_id,node_id,success,failure_code) VALUES($1,$2,$3,false,$4)`,[makeId('prnra'),node.organization_id,node.id,'INVALID_RELEASE_CREDENTIAL']);throw fail('INVALID_RELEASE_CREDENTIAL','Release credential is invalid or no longer available');}
      const names=(Array.isArray(data.printerSystemNames)?data.printerSystemNames:[]).map(String).filter(Boolean);if(!names.length){await this.#releaseFailure(tx,node,c,'NO_LOCAL_PRINTER');throw fail('NO_LOCAL_PRINTER','This release station has no ready printers');}
      let printer=null;if(c.printer_id)printer=(await tx.query(`SELECT id,name,system_name FROM prn_printers WHERE id=$1 AND organization_id=$2 AND node_id=$3 AND status='ready' AND system_name=ANY($4::text[])`,[c.printer_id,node.organization_id,node.id,names])).rows[0];
      else if(c.route_pool_id)printer=(await tx.query(`SELECT p.id,p.name,p.system_name FROM prn_printer_pool_members m JOIN prn_printers p ON p.id=m.printer_id AND p.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.pool_id=$2 AND m.enabled=true AND p.node_id=$3 AND p.status='ready' AND p.system_name=ANY($4::text[]) ORDER BY m.priority,p.name LIMIT 1`,[node.organization_id,c.route_pool_id,node.id,names])).rows[0];
      else printer=(await tx.query(`SELECT id,name,system_name FROM prn_printers WHERE organization_id=$1 AND node_id=$2 AND status='ready' AND system_name=ANY($3::text[]) ORDER BY name LIMIT 1`,[node.organization_id,node.id,names])).rows[0];
      if(!printer){await this.#releaseFailure(tx,node,c,'RELEASE_WRONG_STATION');throw fail('RELEASE_WRONG_STATION','This job cannot be released at this Printerly station');}
      const moved=await tx.query(`UPDATE prn_jobs SET status='queued',printer_id=$1,route_reason='Secure release station',routed_at=now(),released_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='held' AND secure_release=true`,[printer.id,c.job_id,node.organization_id]);if(moved.rowCount!==1)throw fail('RELEASE_ALREADY_USED','This job is no longer waiting for secure release');
      await tx.query(`UPDATE prn_release_credentials SET used_at=now(),used_node_id=$1,used_printer_id=$2 WHERE id=$3`,[node.id,printer.id,c.id]);await tx.query(`UPDATE prn_release_credentials SET revoked_at=COALESCE(revoked_at,now()) WHERE organization_id=$1 AND job_id=$2 AND id<>$3 AND used_at IS NULL`,[node.organization_id,c.job_id,c.id]);
      await tx.query(`INSERT INTO prn_release_attempt_log(id,organization_id,node_id,credential_id,success) VALUES($1,$2,$3,$4,true)`,[makeId('prnra'),node.organization_id,node.id,c.id]);
      await tx.query(`INSERT INTO prn_dispatch_outbox(id,organization_id,job_id,event_type,status,available_at) VALUES($1,$2,$3,'dispatch','pending',now()) ON CONFLICT(organization_id,job_id,event_type) DO NOTHING`,[makeId('prnout'),node.organization_id,c.job_id]);
      return{released:true,jobId:c.job_id,jobNumber:c.job_number,title:c.title,printerId:printer.id,printerName:printer.name};
    });
  }
  async #releaseFailure(tx,node,c,code){const attempts=Number(c.attempts||0)+1;await tx.query(`UPDATE prn_release_credentials SET attempts=$1,locked_at=CASE WHEN $1>=max_attempts THEN now() ELSE locked_at END WHERE id=$2`,[attempts,c.id]);await tx.query(`INSERT INTO prn_release_attempt_log(id,organization_id,node_id,credential_id,success,failure_code) VALUES($1,$2,$3,$4,false,$5)`,[makeId('prnra'),node.organization_id,node.id,c.id,code]);}
}

export function secureReleasePin(){return String(randomInt(0,1_000_000)).padStart(6,'0');}
