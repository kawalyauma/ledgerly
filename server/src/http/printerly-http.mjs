const READ_ROLES=new Set(['owner','admin','viewer','manager','accountant']);
const WRITE_ROLES=new Set(['owner','admin','manager','accountant']);
const READ_SCOPES=new Set(['school:read','documents:read','reports:read','journals:read','accounts:read']);
const WRITE_SCOPES=new Set(['school:write','documents:write','reports:write','journals:write']);

export function printerlyHttpError(code,message,status=400){const error=new Error(message);error.code=code;error.status=status;return error;}
export function header(request,name){const value=request.headers?.[name.toLowerCase()]??request.headers?.get?.(name);return Array.isArray(value)?value[0]:value==null?'':String(value);}
export async function readJson(request,limit=2*1024*1024){let total=0;const chunks=[];for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=bytes.length;if(total>limit)throw printerlyHttpError('REQUEST_TOO_LARGE','Request body is too large',413);chunks.push(bytes);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw printerlyHttpError('INVALID_JSON','Request body must be valid JSON',400);}}
export async function authenticatePrinterly(runtime,request,{write=false}={}){
  const principal=await runtime.auth.authenticateRequest({headers:request.headers});
  const module=(await runtime.services.database.query(`SELECT enabled FROM organization_modules WHERE organization_id=$1 AND module_key='printerly'`,[principal.organizationId])).rows[0];
  if(!module||!Boolean(module.enabled))throw printerlyHttpError('MODULE_DISABLED','Printerly is not enabled for this organization',403);
  const roles=write?WRITE_ROLES:READ_ROLES,scopes=write?WRITE_SCOPES:READ_SCOPES;
  if(roles.has(principal.role)||principal.scopes?.some(scope=>scopes.has(scope)))return principal;
  throw printerlyHttpError('FORBIDDEN',write?'You do not have permission to submit Printerly jobs':'You do not have permission to use Printerly',403);
}
export function httpifyPrinterlyError(error){if(error?.status)return error;const code=String(error?.code||'');const status=code.endsWith('_NOT_FOUND')||code==='JOB_NOT_FOUND'||code==='APPROVAL_NOT_FOUND'?404:code.includes('FORBIDDEN')||code.includes('APPROVER')||code.includes('SELF_APPROVAL')?403:code.includes('TOO_LARGE')?413:code.includes('UNSUPPORTED')||code.includes('MULTIPART')?415:code.includes('VALIDATION')||code.includes('INVALID_PROJECT')||code.includes('INVALID_DEPARTMENT')||code.includes('INVALID_PRINTER')||code.includes('REQUIRED')||code.includes('EMPTY_FILE')?422:code.includes('UNAVAILABLE')||code.includes('RACE')||code.includes('STATE')||code.includes('DECIDED')||code.includes('QUOTA')||code.includes('POLICY')||code.includes('IN_USE')?409:400;error.status=status;return error;}
export const data=(value,status=200)=>({status,body:{data:value}});
