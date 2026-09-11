import { randomUUID } from 'node:crypto';
export class HumanResourcesService {
  constructor({ repository, audit=null }){ if(!repository) throw new TypeError('repository required'); this.repository=repository; this.audit=audit; }
  async requestLeave({organizationId,actor,id=randomUUID(),employeeId,leaveTypeId,startsOn,endsOn,daysMicros,reason}){
    if(!organizationId||!employeeId||!leaveTypeId||!startsOn||!endsOn) throw new TypeError('organizationId, employeeId, leaveTypeId, startsOn and endsOn are required');
    const row=await this.repository.createLeave({organizationId,id,employeeId,leaveTypeId,startsOn,endsOn,daysMicros:Number(daysMicros),reason,requestedBy:actor?.actorId??null});
    if(this.audit) await this.audit.write({organizationId,actorType:actor?.actorType??'human',actorId:actor?.actorId??'unknown',action:'hr.leave.request',entityType:'hr_leave_request',entityId:row.id,after:row});
    return row;
  }
  async reviewLeave({organizationId,actor,id,decision,notes}){
    if(!['approved','rejected'].includes(decision)) throw new TypeError('decision must be approved or rejected');
    const result=await this.repository.reviewLeave({organizationId,id,status:decision,reviewedBy:actor?.actorId??null,notes});
    if(this.audit) await this.audit.write({organizationId,actorType:actor?.actorType??'human',actorId:actor?.actorId??'unknown',action:`hr.leave.${decision}`,entityType:'hr_leave_request',entityId:id,before:result.before,after:result.after,reason:notes??null});
    return result.after;
  }
  submitMobileLeaveIntent(input){ return this.repository.submitMobileLeaveIntent(input); }
  processMobileLeaveIntent(input){ return this.repository.processMobileLeaveIntent(input); }
}
