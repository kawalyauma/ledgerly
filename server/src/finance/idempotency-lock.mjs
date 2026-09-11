function required(value,name){const text=String(value??'').trim();if(!text)throw new TypeError(`${name} is required`);return text;}

export async function withFinanceIdempotencyLock(database,{organizationId,namespace,key},work){
  if(!database||typeof database.transaction!=='function')throw new TypeError('database.transaction is required');
  if(typeof work!=='function')throw new TypeError('work is required');
  const org=required(organizationId,'organizationId');
  const scope=required(namespace,'namespace');
  const token=required(key,'idempotencyKey');
  return database.transaction(async tx=>{
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`,[`${scope}:${org}`,token]);
    return work();
  });
}
