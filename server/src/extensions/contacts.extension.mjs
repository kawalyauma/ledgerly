import { PostgresContactsRepository } from '../contacts/repository.mjs';
import { ContactsService } from '../contacts/service.mjs';
export default {
  name:'contacts', required:false,
  configure(env){ return { enabled:String(env.SELFHOST_CONTACTS_ENABLED??'').toLowerCase()==='true' }; },
  enabled(c){ return c.enabled===true; },
  async create({services}){
    const repository=new PostgresContactsRepository({database:services.database});
    const service=new ContactsService({repository,audit:services.audit});
    return { value:Object.freeze({repository,service}), readiness:async()=>{const r=await services.database.query(`SELECT to_regclass('public.contacts') IS NOT NULL AS contacts`);return {ok:r.rows[0]?.contacts===true,provider:'postgresql-contacts'};}, describe(){return {provider:'postgresql-contacts',cloudflareFallbackPreserved:true};} };
  }
};
