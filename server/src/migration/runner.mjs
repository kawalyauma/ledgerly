import {
  assertMigrationPrerequisites, checkpointTable, createMigrationRun, ensureMigrationMetadata, ensureTableState, failTable,
  finishRun, finishTableCopy, markTableCopying, recordValidation, resumeLatestRun,
} from "./bookkeeping.mjs";
import { getMigrationPhase } from "./phases.mjs";
import { validateRelationshipChecks, validateTableCounts } from "./validators.mjs";

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}
function buildUpsert(table, rows) {
  if (!rows.length) return null;
  const columns=table.columns, values=[];
  const groups=rows.map(row=>`(${columns.map(column=>{values.push(row[column]??null);return `$${values.length}`;}).join(",")})`);
  const conflict=table.conflict.map(quoteIdentifier).join(",");
  const mutable=columns.filter(column=>!table.conflict.includes(column));
  const update=mutable.length?`DO UPDATE SET ${mutable.map(column=>`${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`).join(",")}`:"DO NOTHING";
  return {sql:`INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(",")}) VALUES ${groups.join(",")} ON CONFLICT (${conflict}) ${update}`,values};
}
function parseJson(value){if(value==null)return null;if(typeof value==="object")return value;try{return JSON.parse(value);}catch{return null;}}
function snapshotMatches(expected,actual){if(!expected||!actual)return false;return Object.entries(expected).every(([key,value])=>actual[key]===value);}

export class D1MigrationRunner {
  constructor({ database, source, sourceIdentity, phase = "auth-core", batchSize = 250, logger = console }) {
    if (!database || !source) throw new TypeError("D1MigrationRunner requires database and source");
    this.database=database;this.source=source;this.sourceIdentity=sourceIdentity;
    this.phase=typeof phase==="string"?getMigrationPhase(phase):phase;
    if(!this.phase?.name||!Array.isArray(this.phase.tables)||typeof this.phase.ensureSchema!=="function")throw new TypeError("D1MigrationRunner requires a valid migration phase");
    this.batchSize=Math.max(1,Math.min(Number(batchSize)||250,1000));this.logger=logger;
  }
  async prepare(){await ensureMigrationMetadata(this.database);await this.phase.ensureSchema(this.database);}
  async sourceSnapshot(table){return typeof this.source.snapshot==="function"?this.source.snapshot(table.name,{columns:table.columns}):{count:await this.source.count(table.name)};}
  async assertPrerequisites(){return assertMigrationPrerequisites(this.database,{sourceIdentity:this.sourceIdentity,prerequisites:this.phase.prerequisites??[]});}
  async plan(tables=this.phase.tables){const items=[];for(const table of tables){const exists=await this.source.tableExists(table.name);items.push({table:table.name,exists,sourceCount:exists?await this.source.count(table.name):null,dependencies:table.dependencies});}return{phase:this.phase.name,description:this.phase.description,prerequisites:this.phase.prerequisites??[],sourceIdentity:this.sourceIdentity,tables:items};}
  async run({ resume=true, tables=this.phase.tables, requireStableSource=false }={}){
    await this.prepare();await this.assertPrerequisites();const phaseName=this.phase.name;
    const existingRun=resume?await resumeLatestRun(this.database,{sourceIdentity:this.sourceIdentity,phase:phaseName}):null;
    const runId=existingRun??await createMigrationRun(this.database,{sourceIdentity:this.sourceIdentity,phase:phaseName,metadata:{batchSize:this.batchSize,tableCount:tables.length,prerequisites:this.phase.prerequisites??[],requireStableSource}});
    try{
      for(const table of tables)await this.copyTable(runId,table,{requireStableSource});
      if(typeof this.phase.finalizeSchema==="function")await this.phase.finalizeSchema(this.database);
      let validationFailed=false;for(const table of tables){const result=await validateTableCounts(this.database,this.source,runId,table);if(!result.ok)validationFailed=true;}
      const relationships=await validateRelationshipChecks(this.database,runId,this.phase.relationshipChecks??[]);if(!relationships.ok)validationFailed=true;
      await finishRun(this.database,runId,validationFailed?"validation_failed":"completed");return{runId,phase:phaseName,status:validationFailed?"validation_failed":"completed"};
    }catch(error){await finishRun(this.database,runId,"failed",error instanceof Error?error.message:String(error)).catch(()=>undefined);throw error;}
  }
  async copyTable(runId,table,{requireStableSource=false}={}){
    if(!await this.source.tableExists(table.name)){const error=new Error(`Required D1 table is missing: ${table.name}`);await recordValidation(this.database,runId,{tableName:table.name,checkName:"source_table_exists",status:"failed",expected:{exists:true},actual:{exists:false}});throw error;}
    const sourceSnapshotStart=await this.sourceSnapshot(table), sourceCountStart=sourceSnapshotStart.count;
    const state=await ensureTableState(this.database,runId,table.name,sourceCountStart);if(state.status==="validated")return;
    await markTableCopying(this.database,runId,table.name);let cursor=Number(state.last_rowid??0),copiedRows=Number(state.copied_rows??0);
    try{
      while(true){const batch=await this.source.batch(table.name,{columns:table.columns,afterRowid:cursor,limit:this.batchSize});if(batch.length===0)break;const transformed=batch.map(row=>table.transform(row));const nextCursor=Math.max(...batch.map(row=>Number(row.__ledgerly_rowid)));const nextCopiedRows=copiedRows+batch.length;const upsert=buildUpsert(table,transformed);await this.database.transaction(async tx=>{if(upsert)await tx.query(upsert.sql,upsert.values);await checkpointTable(tx,runId,table.name,{lastRowid:nextCursor,copiedRows:nextCopiedRows});});cursor=nextCursor;copiedRows=nextCopiedRows;this.logger.info?.(JSON.stringify({component:"d1-migration",phase:this.phase.name,runId,table:table.name,copiedRows,cursor}));}
      const sourceSnapshotEnd=await this.sourceSnapshot(table),sourceCountEnd=sourceSnapshotEnd.count;
      const target=await this.database.query(`SELECT count(*)::bigint AS count FROM ${quoteIdentifier(table.name)}`),targetCount=Number(target.rows[0]?.count??0);
      await finishTableCopy(this.database,runId,table.name,{sourceCountEnd,targetCount});const stable=snapshotMatches(sourceSnapshotStart,sourceSnapshotEnd)&&snapshotMatches(sourceSnapshotEnd,sourceSnapshotStart);
      await recordValidation(this.database,runId,{tableName:table.name,checkName:"source_stability",status:stable?"passed":"warning",expected:{snapshotStart:sourceSnapshotStart},actual:{snapshotEnd:sourceSnapshotEnd},details:stable?{}:{note:"D1 changed during copy; final cutover requires a write pause and another strict validation pass."}});
      if(requireStableSource&&!stable)throw new Error(`D1 source changed during strict copy: ${table.name}`);
    }catch(error){await failTable(this.database,runId,table.name,error instanceof Error?error.message:String(error)).catch(()=>undefined);throw error;}
  }
  async validate({runId,tables=this.phase.tables,cutover=false}={}){
    await this.prepare();await this.assertPrerequisites();if(typeof this.phase.finalizeSchema==="function")await this.phase.finalizeSchema(this.database);
    let failed=false;const counts=[],sourceStability=[];
    for(const table of tables){
      let before=null,baseline=null;if(cutover){before=await this.sourceSnapshot(table);const prior=await this.database.query(`SELECT actual FROM ledgerly_meta.migration_validations WHERE run_id=$1 AND table_name=$2 AND check_name='source_stability' ORDER BY id DESC LIMIT 1`,[runId,table.name]);const actual=parseJson(prior.rows[0]?.actual);baseline=actual?.snapshotEnd??(actual?.countAtEnd!=null?{count:Number(actual.countAtEnd)}:null);}
      const result=await validateTableCounts(this.database,this.source,runId,table);counts.push({table:table.name,...result});if(!result.ok)failed=true;
      if(cutover){const after=await this.sourceSnapshot(table);const unchangedSinceCopy=snapshotMatches(baseline,before),unchangedDuringValidation=snapshotMatches(before,after)&&snapshotMatches(after,before),ok=Boolean(baseline)&&unchangedSinceCopy&&unchangedDuringValidation;await recordValidation(this.database,runId,{tableName:table.name,checkName:"final_cutover_source_stability",status:ok?"passed":"failed",expected:{copiedSnapshot:baseline,validationStart:before},actual:{validationEnd:after},details:ok?{}:{note:"Source changed since copy or during cutover validation. Keep writes paused, resume copy, and validate again."}});sourceStability.push({table:table.name,ok,baseline,before,after});if(!ok)failed=true;}
    }
    const relationships=await validateRelationshipChecks(this.database,runId,this.phase.relationshipChecks??[]);if(!relationships.ok)failed=true;
    return{ok:!failed,phase:this.phase.name,cutover,counts,relationships,sourceStability};
  }
  async validateCutover(options={}){return this.validate({...options,cutover:true});}
}
