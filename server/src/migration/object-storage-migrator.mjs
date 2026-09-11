import {createHash} from 'node:crypto';

export async function ensureObjectMigrationSchema(database){
  await database.query(`CREATE SCHEMA IF NOT EXISTS ledgerly_meta;
    CREATE TABLE IF NOT EXISTS ledgerly_meta.object_migration_state(
      source_name text NOT NULL,target_name text NOT NULL,object_key text NOT NULL,organization_id text,
      source_size bigint NOT NULL,source_etag text,sha256 text,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,
      migrated_at timestamptz,last_error text,metadata_json text NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(source_name,target_name,object_key)
    );
    CREATE INDEX IF NOT EXISTS object_migration_status_idx ON ledgerly_meta.object_migration_state(source_name,target_name,status,updated_at);`);
}

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export class ObjectStorageMigrator{
  constructor({database,source,target,sourceName='r2',targetName='selfhost',tenantResolver=()=>null}){this.database=database;this.source=source;this.target=target;this.sourceName=sourceName;this.targetName=targetName;this.tenantResolver=tenantResolver;}
  async migratePrefix(prefix=''){
    const keys=await this.source.list(prefix);const result={total:keys.length,migrated:0,skipped:0,failed:0,bytes:0};
    for(const key of keys){try{const outcome=await this.migrateObject(key);result[outcome.skipped?'skipped':'migrated']++;if(!outcome.skipped)result.bytes+=outcome.size;}catch(error){result.failed++;await this.database.query(`INSERT INTO ledgerly_meta.object_migration_state(source_name,target_name,object_key,source_size,status,attempts,last_error,updated_at) VALUES($1,$2,$3,0,'failed',1,$4,now()) ON CONFLICT(source_name,target_name,object_key) DO UPDATE SET status='failed',attempts=ledgerly_meta.object_migration_state.attempts+1,last_error=excluded.last_error,updated_at=now()`,[this.sourceName,this.targetName,key,error instanceof Error?error.message:String(error)]);}}
    return result;
  }
  async migrateObject(key){
    const sourceHead=await this.source.head(key);if(!sourceHead)throw new Error(`Source object missing: ${key}`);
    const current=(await this.database.query(`SELECT status,source_size,source_etag,sha256 FROM ledgerly_meta.object_migration_state WHERE source_name=$1 AND target_name=$2 AND object_key=$3`,[this.sourceName,this.targetName,key])).rows[0];
    const targetHead=await this.target.head(key);
    if(current?.status==='verified'&&Number(current.source_size)===Number(sourceHead.size)&&(!sourceHead.etag||current.source_etag===sourceHead.etag)&&targetHead&&Number(targetHead.size)===Number(sourceHead.size))return{skipped:true,size:Number(sourceHead.size)};
    const bytes=await this.source.get(key),digest=sha256(bytes),organizationId=await this.tenantResolver(key,sourceHead);
    await this.target.put(key,bytes,{contentType:sourceHead.metadata?.['content-type']??sourceHead.metadata?.contentType,custom:{sha256:digest,source:this.sourceName,organizationId:organizationId??''}});
    const verified=await this.target.head(key);if(!verified||Number(verified.size)!==bytes.length)throw new Error(`Target size verification failed: ${key}`);
    await this.database.query(`INSERT INTO ledgerly_meta.object_migration_state(source_name,target_name,object_key,organization_id,source_size,source_etag,sha256,status,attempts,migrated_at,last_error,metadata_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'verified',1,now(),NULL,$8,now()) ON CONFLICT(source_name,target_name,object_key) DO UPDATE SET organization_id=excluded.organization_id,source_size=excluded.source_size,source_etag=excluded.source_etag,sha256=excluded.sha256,status='verified',attempts=ledgerly_meta.object_migration_state.attempts+1,migrated_at=now(),last_error=NULL,metadata_json=excluded.metadata_json,updated_at=now()`,[this.sourceName,this.targetName,key,organizationId,bytes.length,sourceHead.etag??null,digest,JSON.stringify(sourceHead.metadata??{})]);
    return{skipped:false,size:bytes.length,sha256:digest,organizationId};
  }
  async validate(prefix=''){
    const keys=await this.source.list(prefix),failures=[];let bytes=0;
    for(const key of keys){const source=await this.source.head(key),target=await this.target.head(key);if(!source||!target||Number(source.size)!==Number(target.size)){failures.push({key,sourceSize:source?.size??null,targetSize:target?.size??null});continue}bytes+=Number(source.size);}
    return{ok:failures.length===0,sourceCount:keys.length,verifiedCount:keys.length-failures.length,bytes,failures};
  }
}
