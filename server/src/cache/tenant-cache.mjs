const safe=v=>{if(typeof v!=='string'||!v.trim())throw new TypeError('tenant cache scope is required');return v.trim().replace(/[^a-zA-Z0-9._-]/g,'_')};
export const CACHE_DOMAINS=Object.freeze(['organization-settings','school-config','academic-years','terms','classes','subjects','roles-permissions','accounts','fee-categories','dashboard-summary','reference-counts']);
export class TenantCache{
  constructor({cache,organizationId}){if(!cache)throw new TypeError('cache is required');this.cache=cache;this.organizationId=safe(organizationId)}
  key(domain,suffix='all'){if(!CACHE_DOMAINS.includes(domain))throw new TypeError(`Unknown cache domain: ${domain}`);return `org:${this.organizationId}:${domain}:${safe(String(suffix))}`}
  tag(domain){if(!CACHE_DOMAINS.includes(domain))throw new TypeError(`Unknown cache domain: ${domain}`);return `org:${this.organizationId}:${domain}`}
  get(domain,suffix){return this.cache.get(this.key(domain,suffix))}
  remember(domain,suffix,producer,{ttlMs=60000}={}){return this.cache.remember(this.key(domain,suffix),producer,{ttlMs,tags:[this.tag(domain),`org:${this.organizationId}`]})}
  async invalidateAfterCommit(domains){for(const domain of new Set(domains))await this.cache.invalidateTag(this.tag(domain))}
}
export function createPostCommitInvalidator({cache,organizationId}){
  const tenant=new TenantCache({cache,organizationId});
  const domains=new Set();
  return Object.freeze({mark(...items){for(const item of items){if(!CACHE_DOMAINS.includes(item))throw new TypeError(`Unknown cache domain: ${item}`);domains.add(item)}},async committed(){await tenant.invalidateAfterCommit([...domains]);domains.clear()},rollback(){domains.clear()}});
}
