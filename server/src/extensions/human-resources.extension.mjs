import { PostgresHumanResourcesRepository } from '../human-resources/repository.mjs';
import { HumanResourcesService } from '../human-resources/service.mjs';
import { createHumanResourcesApiService } from '../human-resources/api-service.mjs';

function cutover(value){const mode=String(value??'cloudflare').trim().toLowerCase();if(!['cloudflare','shadow','node'].includes(mode))throw new Error('LEDGERLY_HR_CUTOVER must be cloudflare, shadow, or node');return mode;}

export default {
  name:'human-resources', required:false,
  configure(env){return{
    enabled:String(env.LEDGERLY_HR_SELFHOST_ENABLED??env.SELFHOST_HR_ENABLED??'').toLowerCase()==='true',
    cutover:cutover(env.LEDGERLY_HR_CUTOVER),
  };},
  enabled(c){return c.enabled===true;},
  async create({services,extensionConfig}){
    const repository=new PostgresHumanResourcesRepository({database:services.database});
    const service=new HumanResourcesService({repository,audit:services.audit});
    const api=createHumanResourcesApiService({database:services.database,audit:services.audit});
    return {
      value:Object.freeze({repository,service,api}),
      readiness:()=>api.readiness(),
      describe(){return{...api.describe(),cutover:extensionConfig.cutover,payrollOwnedElsewhere:true,cloudflareFallbackPreserved:true};},
    };
  }
};
