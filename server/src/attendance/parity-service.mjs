import { randomUUID } from 'node:crypto';
import { AttendanceService } from './service.mjs';

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
function makeId(prefix){return `${prefix}_${randomUUID().replaceAll('-','')}`;}
function camel(row){const out={};for(const[key,value]of Object.entries(row??{}))out[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=value;return out;}

export class AttendanceParityService extends AttendanceService {
  async offlineSync({organizationId,userId=null,deviceId,clientBatchId,events,actorType='device'}){
    if(!String(deviceId??'').trim()||!String(clientBatchId??'').trim()||!Array.isArray(events)||events.length<1||events.length>500)fail(422,'VALIDATION_ERROR','Invalid offline sync batch');
    const device=await this.database.query(`SELECT * FROM att_devices WHERE id=$1 AND organization_id=$2 AND status='active'`,[deviceId,organizationId]);
    if(!device.rows[0])fail(403,'DEVICE_INACTIVE','The attendance device is not active');
    const old=await this.database.query(`SELECT * FROM att_device_sync_batches WHERE organization_id=$1 AND device_id=$2 AND client_batch_id=$3`,[organizationId,deviceId,clientBatchId]);
    if(old.rows[0])return{...camel(old.rows[0]),idempotent:true,results:[]};

    const batchId=makeId('asb');
    await this.database.query(`INSERT INTO att_device_sync_batches(id,organization_id,device_id,client_batch_id,event_count) VALUES($1,$2,$3,$4,$5)`,[batchId,organizationId,deviceId,clientBatchId,events.length]);
    let accepted=0,duplicates=0,rejected=0;
    const results=[];
    for(const raw of events){
      try{
        const verificationMode=String(raw?.verificationMode??'STANDARD').toUpperCase();
        let official=true;
        if(verificationMode==='TEST'){
          const grant=await this.database.query(`SELECT 1 FROM att_test_mode_grants WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY enabled_at DESC LIMIT 1`,[organizationId,deviceId]);
          if(!grant.rows[0])throw new Error('Face test mode is no longer active');
          official=false;
        }
        const result=await this.recordEvent({organizationId,userId,input:{...raw,deviceId,syncBatchId:batchId,syncedAt:new Date().toISOString(),official},actorType});
        if(result.duplicate){duplicates++;results.push({clientEventId:raw?.clientEventId,status:'duplicate',eventId:result.eventId});}
        else if(result.rejected){rejected++;results.push({clientEventId:raw?.clientEventId,status:'rejected',message:'Attendance verification was rejected',eventId:result.eventId});}
        else{accepted++;results.push({clientEventId:raw?.clientEventId,status:'accepted',eventId:result.eventId});}
      }catch(error){
        rejected++;
        results.push({clientEventId:raw?.clientEventId,status:'rejected',message:error instanceof Error?error.message:String(error)});
      }
    }
    const status=rejected===events.length?'rejected':rejected?'partial':'processed';
    await this.database.query(`UPDATE att_device_sync_batches SET accepted_count=$1,duplicate_count=$2,rejected_count=$3,status=$4,completed_at=now() WHERE id=$5`,[accepted,duplicates,rejected,status,batchId]);
    await this.database.query(`UPDATE att_devices SET last_sync_at=now(),last_seen_at=now() WHERE id=$1`,[deviceId]);
    await this.auditEvent({organizationId,actorType,actorId:actorType==='device'?deviceId:userId,action:'offline_sync.processed',entityType:'sync_batch',entityId:batchId,details:{accepted,duplicates,rejected}});
    return{id:batchId,eventCount:events.length,accepted,duplicates,rejected,status,results};
  }
}

export function createAttendanceParityService(options){return new AttendanceParityService(options);}
