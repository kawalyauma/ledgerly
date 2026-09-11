import { PostgresHumanResourcesRepository } from '../human-resources/repository.mjs';
import { HumanResourcesService } from '../human-resources/service.mjs';
export default {
  name:'human-resources', required:false,
  configure(env){ return { enabled:String(env.SELFHOST_HR_ENABLED??'').toLowerCase()==='true' }; },
  enabled(c){ return c.enabled===true; },
  async create({services}){
    const repository=new PostgresHumanResourcesRepository({database:services.database});
    const service=new HumanResourcesService({repository,audit:services.audit});
    return { value:Object.freeze({repository,service}), readiness:async()=>{const r=await services.database.query(`SELECT to_regclass('public.hr_employees') IS NOT NULL AS employees,to_regclass('public.hr_leave_requests') IS NOT NULL AS leave_requests`);const x=r.rows[0]??{};return {ok:x.employees===true&&x.leave_requests===true,provider:'postgresql-human-resources'};}, describe(){return {provider:'postgresql-human-resources',payrollOwnedElsewhere:true,cloudflareFallbackPreserved:true};} };
  }
};
