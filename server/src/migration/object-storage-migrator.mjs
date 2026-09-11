import {createHash} from 'node:crypto';
import {tenantStorageKey} from '../contracts.mjs';

export async function ensureObjectMigrationSchema(database){
  await database.query(`CREATE SCHEMA IF NOT EXISTS ledgerly_meta;
    CREATE TABLE IF NOT EXISTS ledgerly_meta.object_migration_state(
      source_name text NOT NULL,target_name text NOT NULL,object_key text NOT NULL,organization_id text,
      target_key text,
      source_size bigint NOT NULL,source_etag text,sha256 text,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,
      migrated_at timestamptz,last_error text,metadata_json text NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(source_name,target_name,object_key)
    );
    ALTER TABLE ledgerly_meta.object_migration_state ADD COLUMN IF NOT EXISTS target_key text;
    CREATE INDEX IF NOT EXISTS object_migration_status_idx ON ledgerly_meta.object_migration_state(source_name,target_name,status,updated_at);
    CREATE INDEX IF NOT EXISTS object_migration_tenant_target_idx ON ledgerly_meta.object_migration_state(organization_id,target_key) WHERE status='verified';`);
}

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function text(value,name){if(typeof value!=='string'||!value.trim())throw new Error(`${name} is required`);return value.trim();}
function defaultTargetKey(organizationId,sourceKey){
  const org=text(organizationId,'organizationId');
  const raw=text(sourceKey,'source object key').replaceAll('\\','/').replace(/^\/+/, '');
  // Legacy sources occasionally already used org/<id>/... keys. Strip exactly that
  // prefix before applying the canonical tenant namespace to avoid double scoping.
  const prefix=`org/${encodeURIComponent(org)}/`;
  const logical=raw.startsWith(prefix)?raw.slice(prefix.length):raw;
  return tenantStorageKey(org,logical);
}
function metadataSha(head){
  const metadata=head?.metadata??{};
  return metadata.sha256??metadata['x-amz-meta-sha256']??metadata['X-Amz-Meta-sha256']??null;
}

export class ObjectStorageMigrator{
  constructor({database,source,target,sourceName='r2',targetName='selfhost',tenantResolver,targetKeyResolver=defaultTargetKey}){
    if(!database?.query)throw new TypeError('database.query is required');
    for(const [name,service] of [['source',source],['target',target]])for(const method of ['list','head','get',...(name==='target'?['put']:[])])if(typeof service?.[method]!=='function')throw new TypeError(`${name}.${method} is required`);
    if(typeof tenantResolver!=='function')throw new TypeError('tenantResolver is required; unscoped object migration is forbidden');
    if(typeof targetKeyResolver!=='function')throw new TypeError('targetKeyResolver is required');
    this.database=database;this.source=source;this.target=target;this.sourceName=sourceName;this.targetName=targetName;this.tenantResolver=tenantResolver;this.targetKeyResolver=targetKeyResolver;
  }
  async migratePrefix(prefix=''){
    const keys=await this.source.list(prefix);const result={total:keys.length,migrated:0,skipped:0,failed:0,bytes:0};
    for(const key of keys){
      try{const outcome=await this.migrateObject(key);result[outcome.skipped?'skipped':'migrated']++;if(!outcome.skipped)result.bytes+=outcome.size;}
      catch(error){result.failed++;await this.database.query(`INSERT INTO ledgerly_meta.object_migration_state(source_name,target_name,object_key,source_size,status,attempts,last_error,updated_at) VALUES($1,$2,$3,0,'failed',1,$4,now()) ON CONFLICT(source_name,target_name,object_key) DO UPDATE SET status='failed',attempts=ledgerly_meta.object_migration_state.attempts+1,last_error=excluded.last_error,updated_at=now()`,[this.sourceName,this.targetName,key,error instanceof Error?error.message:String(error)]);}
    }
    return result;
  }
  async resolveTarget(key,sourceHead=null){
    const head=sourceHead??await this.source.head(key);if(!head)throw new Error(`Source object missing: ${key}`);
    const organizationId=text(await this.tenantResolver(key,head),'tenantResolver organizationId');
    const targetKey=text(await this.targetKeyResolver(organizationId,key,head),'targetKey');
    const canonicalPrefix=`org/${encodeURIComponent(organizationId)}/`;
    if(!targetKey.startsWith(canonicalPrefix))throw new Error(`Target key escaped tenant scope for ${key}`);
    return{organizationId,targetKey,sourceHead:head};
  }
  async migrateObject(key){
    const sourceHead=await this.source.head(key);if(!sourceHead)throw new Error(`Source object missing: ${key}`);
    const{organizationId,targetKey}=await this.resolveTarget(key,sourceHead);
    const current=(await this.database.query(`SELECT status,organization_id,target_key,source_size,source_etag,sha256 FROM ledgerly_meta.object_migration_state WHERE source_name=$1 AND target_name=$2 AND object_key=$3`,[this.sourceName,this.targetName,key])).rows[0];
    const targetHead=await this.target.head(targetKey);
    if(current?.status==='verified'&&current.organization_id===organizationId&&current.target_key===targetKey&&Number(current.source_size)===Number(sourceHead.size)&&(!sourceHead.etag||current.source_etag===sourceHead.etag)&&targetHead&&Number(targetHead.size)===Number(sourceHead.size)&&(!metadataSha(targetHead)||metadataSha(targetHead)===current.sha256))return{skipped:true,size:Number(sourceHead.size),organizationId,targetKey};
    const bytes=await this.source.get(key);if(bytes==null)throw new Error(`Source object unreadable: ${key}`);const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),digest=sha256(body);
    await this.target.put(targetKey,body,{contentType:sourceHead.metadata?.['content-type']??sourceHead.metadata?.contentType,custom:{sha256:digest,source:this.sourceName,sourceKey:key,organizationId}});
    const verified=await this.target.head(targetKey);if(!verified||Number(verified.size)!==body.length)throw new Error(`Target size verification failed: ${key}`);
    const targetDigest=metadataSha(verified);if(targetDigest&&targetDigest!==digest)throw new Error(`Target checksum verification failed: ${key}`);
    await this.database.query(`INSERT INTO ledgerly_meta.object_migration_state(source_name,target_name,object_key,organization_id,target_key,source_size,source_etag,sha256,status,attempts,migrated_at,last_error,metadata_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'verified',1,now(),NULL,$9,now()) ON CONFLICT(source_name,target_name,object_key) DO UPDATE SET organization_id=excluded.organization_id,target_key=excluded.target_key,source_size=excluded.source_size,source_etag=excluded.source_etag,sha256=excluded.sha256,status='verified',attempts=ledgerly_meta.object_migration_state.attempts+1,migrated_at=now(),last_error=NULL,metadata_json=excluded.metadata_json,updated_at=now()`,[this.sourceName,this.targetName,key,organizationId,targetKey,body.length,sourceHead.etag??null,digest,JSON.stringify(sourceHead.metadata??{})]);
    return{skipped:false,size:body.length,sha256:digest,organizationId,targetKey};
  }
  async lookupMigratedObject(key){
    const row=(await this.database.query(`SELECT organization_id,target_key,source_size,sha256,status FROM ledgerly_meta.object_migration_state WHERE source_name=$1 AND target_name=$2 AND object_key=$3`,[this.sourceName,this.targetName,key])).rows[0];
    return row?.status==='verified'&&row.target_key?row:null;
  }
  async validate(prefix=''){
    const keys=await this.source.list(prefix),failures=[];let bytes=0;
    for(const key of keys){
      try{const source=await this.source.head(key);if(!source){failures.push({key,reason:'source-missing'});continue}const{organizationId,targetKey}=await this.resolveTarget(key,source);const target=await this.target.head(targetKey);const state=await this.lookupMigratedObject(key);
        const valid=target&&state&&state.organization_id===organizationId&&state.target_key===targetKey&&Number(source.size)===Number(target.size)&&Number(source.size)===Number(state.source_size)&&(!metadataSha(target)||metadataSha(target)===state.sha256);
        if(!valid){failures.push({key,organizationId,targetKey,sourceSize:source.size,targetSize:target?.size??null,state:state?.status??null});continue}bytes+=Number(source.size);
      }catch(error){failures.push({key,reason:error instanceof Error?error.message:String(error)});}
    }
    return{ok:failures.length===0,sourceCount:keys.length,verifiedCount:keys.length-failures.length,bytes,failures};
  }
}

export {defaultTargetKey};
