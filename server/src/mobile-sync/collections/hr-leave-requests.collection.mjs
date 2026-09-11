export async function createCollection({services}){
  if(!services?.database) throw new TypeError('database service required');
  return Object.freeze({
    moduleKey:'human-resources', collectionKey:'leave_requests',
    async canRead({organizationId,userId,recordId}){
      const result=await services.database.query(`SELECT 1 FROM hr_leave_requests r JOIN hr_employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.id=$2 AND (e.user_id=$3 OR r.requested_by=$3 OR r.reviewed_by=$3) LIMIT 1`,[organizationId,recordId,userId]);
      return result.rowCount>0;
    }
  });
}
