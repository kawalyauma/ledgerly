import { PostgresContactsRepository } from '../contacts/repository.mjs';
import { ContactsService } from '../contacts/service.mjs';
import { createContactsApiService } from '../contacts/api-service.mjs';

function cutover(value){const mode=String(value??'cloudflare').trim().toLowerCase();if(!['cloudflare','shadow','node'].includes(mode))throw new Error('LEDGERLY_CONTACTS_CUTOVER must be cloudflare, shadow, or node');return mode;}

export default {
  name:'contacts', required:false,
  configure(env){return{
    enabled:String(env.LEDGERLY_CONTACTS_SELFHOST_ENABLED??env.SELFHOST_CONTACTS_ENABLED??'').toLowerCase()==='true',
    cutover:cutover(env.LEDGERLY_CONTACTS_CUTOVER),
  };},
  enabled(c){return c.enabled===true;},
  async create({services,extensionConfig}){
    const repository=new PostgresContactsRepository({database:services.database});
    const service=new ContactsService({repository,audit:services.audit});
    const api=createContactsApiService({database:services.database,repository,audit:services.audit});
    return {
      value:Object.freeze({repository,service,api}),
      readiness:()=>api.readiness(),
      describe(){return{...api.describe(),cutover:extensionConfig.cutover,cloudflareFallbackPreserved:true};},
    };
  }
};
