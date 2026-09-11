async function hrChange(tx, { organizationId, collectionKey, recordId, payload, changedBy }) {
  const v = await tx.query(
    `INSERT INTO mobile_sync_record_versions (organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at)
     VALUES ($1,'human-resources',$2,$3,1,false,now()) ON CONFLICT (organization_id,module_key,collection_key,record_id)
     DO UPDATE SET version=mobile_sync_record_versions.version+1,deleted=false,server_updated_at=now() RETURNING version`,
    [organizationId,collectionKey,recordId],
  );
  await tx.query(
    `INSERT INTO mobile_sync_changes (organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,changed_at)
     VALUES ($1,'human-resources',$2,$3,$4,'upsert',$5,$6,now())`,
    [organizationId,collectionKey,recordId,Number(v.rows[0].version),JSON.stringify(payload),changedBy ?? null],
  );
}

export class PostgresHumanResourcesRepository {
  constructor({ database }) { if (!database?.query || !database?.transaction) throw new TypeError('database required'); this.database=database; }
  async employee(organizationId,id){ const r=await this.database.query(`SELECT * FROM hr_employees WHERE organization_id=$1 AND id=$2`,[organizationId,id]); return r.rows[0]??null; }
  async leaveType(organizationId,id){ const r=await this.database.query(`SELECT * FROM hr_leave_types WHERE organization_id=$1 AND id=$2 AND active=true`,[organizationId,id]); return r.rows[0]??null; }
  async getLeave(organizationId,id){ const r=await this.database.query(`SELECT * FROM hr_leave_requests WHERE organization_id=$1 AND id=$2`,[organizationId,id]); return r.rows[0]??null; }
  async createLeave({ organizationId, id, employeeId, leaveTypeId, startsOn, endsOn, daysMicros, reason, requestedBy }){
    return this.database.transaction(async tx=>{
      const employee=await tx.query(`SELECT id FROM hr_employees WHERE organization_id=$1 AND id=$2 AND employment_status='active'`,[organizationId,employeeId]);
      if(!employee.rows[0]) throw Object.assign(new Error('employee not found in organization'),{code:'HR_EMPLOYEE_NOT_FOUND',status:404});
      const lt=await tx.query(`SELECT id FROM hr_leave_types WHERE organization_id=$1 AND id=$2 AND active=true`,[organizationId,leaveTypeId]);
      if(!lt.rows[0]) throw Object.assign(new Error('leave type not found in organization'),{code:'HR_LEAVE_TYPE_NOT_FOUND',status:404});
      const r=await tx.query(`INSERT INTO hr_leave_requests (id,organization_id,employee_id,leave_type_id,starts_on,ends_on,days_micros,reason,status,requested_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,now(),now()) ON CONFLICT (id) DO NOTHING RETURNING *`,[id,organizationId,employeeId,leaveTypeId,startsOn,endsOn,daysMicros,reason??null,requestedBy??null]);
      if(!r.rows[0]){ const e=await tx.query(`SELECT organization_id FROM hr_leave_requests WHERE id=$1`,[id]); throw Object.assign(new Error('leave request id already exists'),{code:e.rows[0]?.organization_id===organizationId?'HR_LEAVE_DUPLICATE':'HR_CROSS_TENANT_ID',status:409}); }
      await hrChange(tx,{organizationId,collectionKey:'leave_requests',recordId:id,payload:r.rows[0],changedBy:requestedBy}); return r.rows[0];
    });
  }
  async reviewLeave({ organizationId, id, status, reviewedBy, notes }){
    return this.database.transaction(async tx=>{
      const before=await tx.query(`SELECT * FROM hr_leave_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[organizationId,id]);
      if(!before.rows[0]) throw Object.assign(new Error('leave request not found'),{code:'HR_LEAVE_NOT_FOUND',status:404});
      if(before.rows[0].status!=='pending') throw Object.assign(new Error('leave request already reviewed'),{code:'HR_LEAVE_ALREADY_REVIEWED',status:409});
      const r=await tx.query(`UPDATE hr_leave_requests SET status=$3,reviewed_by=$4,reviewed_at=now(),review_notes=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[organizationId,id,status,reviewedBy,notes??null]);
      await hrChange(tx,{organizationId,collectionKey:'leave_requests',recordId:id,payload:r.rows[0],changedBy:reviewedBy}); return {before:before.rows[0],after:r.rows[0]};
    });
  }
  async submitMobileLeaveIntent({ organizationId,userId,deviceId,intent }){
    return this.database.transaction(async tx=>{
      const prior=await tx.query(`SELECT * FROM hr_mobile_leave_intents WHERE organization_id=$1 AND id=$2`,[organizationId,intent.id]);
      if(prior.rows[0]) return {...prior.rows[0],duplicate:true};
      const employee=await tx.query(`SELECT id,user_id FROM hr_employees WHERE organization_id=$1 AND id=$2 AND employment_status='active'`,[organizationId,intent.employeeId]);
      if(!employee.rows[0] || employee.rows[0].user_id!==userId) throw Object.assign(new Error('employee is not linked to authenticated user'),{code:'HR_STAFF_SCOPE_DENIED',status:403});
      const id=intent.id; const result=await tx.query(`INSERT INTO hr_mobile_leave_intents (id,organization_id,device_id,employee_id,leave_type_id,starts_on,ends_on,days_micros,reason,requested_by,client_created_at,status,attempts,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',0,now(),now()) RETURNING *`,[id,organizationId,deviceId,intent.employeeId,intent.leaveTypeId,intent.startsOn,intent.endsOn,intent.daysMicros,intent.reason??null,userId,intent.clientCreatedAt]);
      return result.rows[0];
    });
  }
  async processMobileLeaveIntent({ organizationId, intentId }){
    const outcome = await this.database.transaction(async tx=>{
      const q=await tx.query(`SELECT * FROM hr_mobile_leave_intents WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[organizationId,intentId]);
      const intent=q.rows[0];
      if(!intent) throw Object.assign(new Error('mobile leave intent not found'),{code:'HR_MOBILE_INTENT_NOT_FOUND',status:404});
      if(intent.status==='applied') return {ok:true,value:{...intent,duplicate:true}};
      if(intent.status==='rejected') return {ok:true,value:intent};
      const serverId=intent.server_leave_request_id || `leave:${intent.id}`;
      try {
        const lt=await tx.query(`SELECT id FROM hr_leave_types WHERE organization_id=$1 AND id=$2 AND active=true`,[organizationId,intent.leave_type_id]);
        if(!lt.rows[0]) throw Object.assign(new Error('leave type not available'),{code:'HR_LEAVE_TYPE_NOT_FOUND',status:404});
        const created=await tx.query(`INSERT INTO hr_leave_requests (id,organization_id,employee_id,leave_type_id,starts_on,ends_on,days_micros,reason,status,requested_by,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,now(),now()) ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id RETURNING *`,[serverId,organizationId,intent.employee_id,intent.leave_type_id,intent.starts_on,intent.ends_on,intent.days_micros,intent.reason,intent.requested_by]);
        await tx.query(`UPDATE hr_mobile_leave_intents SET status='applied',server_leave_request_id=$3,attempts=attempts+1,last_attempt_at=now(),next_attempt_at=NULL,error_message=NULL,applied_at=COALESCE(applied_at,now()),updated_at=now() WHERE organization_id=$1 AND id=$2`,[organizationId,intentId,serverId]);
        await hrChange(tx,{organizationId,collectionKey:'leave_requests',recordId:serverId,payload:created.rows[0],changedBy:intent.requested_by});
        return {ok:true,value:{...intent,status:'applied',server_leave_request_id:serverId,applied_at:new Date().toISOString()}};
      } catch(error) {
        await tx.query(`UPDATE hr_mobile_leave_intents SET status='pending',attempts=attempts+1,last_attempt_at=now(),next_attempt_at=now()+interval '5 minutes',error_message=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,[organizationId,intentId,error instanceof Error?error.message:String(error)]);
        return {ok:false,error:{message:error instanceof Error?error.message:String(error),code:error?.code??'HR_MOBILE_INTENT_RETRY',status:error?.status??503}};
      }
    });
    if(!outcome.ok) throw Object.assign(new Error(outcome.error.message),{code:outcome.error.code,status:outcome.error.status});
    return outcome.value;
  }
}
