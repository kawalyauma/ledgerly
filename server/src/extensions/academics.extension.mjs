import { createAcademicsService } from '../academics/service.mjs';

function cutover(value){const mode=String(value??'cloudflare').trim().toLowerCase();if(!['cloudflare','shadow','node'].includes(mode))throw new Error('LEDGERLY_ACADEMICS_CUTOVER must be cloudflare, shadow, or node');return mode;}

export default{
  name:'academics',
  required:true,
  configure(env){return{enabled:String(env.LEDGERLY_ACADEMICS_SELFHOST_ENABLED??env.SELFHOST_ACADEMICS_ENABLED??'').toLowerCase()==='true',cutover:cutover(env.LEDGERLY_ACADEMICS_CUTOVER)};},
  enabled(config){return config.enabled===true;},
  async create({services,extensionConfig}){
    const api=createAcademicsService({database:services.database,audit:services.audit});
    return{
      value:Object.freeze({api}),
      readiness:()=>api.readiness(),
      describe(){return{...api.describe(),cutover:extensionConfig.cutover,cloudflareFallbackPreserved:true};}
    };
  }
};
