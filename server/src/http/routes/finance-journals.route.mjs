import {authenticateFinance,mapFinanceError,ok,pagination,readJson,requiredHeader} from '../../finance/http.mjs';
const PREFIX='/api/v1/journals',parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{name:'finance-journals',prefix:PREFIX,business:true,priority:95,enabled(config){return config.extensions?.['finance-api']?.journalsCutover==='node'},async handle({request,url,runtime}){try{const api=runtime.extensions?.['finance-api']?.journals;if(!api)throw Object.assign(new Error('Finance journals runtime unavailable'),{status:503,code:'FINANCE_SELFHOST_NOT_READY'});const p=parts(url);
 if(request.method==='GET'&&p.length===0){const x=await authenticateFinance(runtime,request,'journals:read'),page=pagination(url);return ok({data:await api.list(x.organizationId,page),pagination:page})}
 if(request.method==='GET'&&p.length===1){const x=await authenticateFinance(runtime,request,'journals:read');return ok({data:await api.get(x.organizationId,p[0])})}
 if(request.method==='POST'&&p.length===0){const x=await authenticateFinance(runtime,request,'journals:write'),key=requiredHeader(request,'Idempotency-Key');return ok({data:await api.create(x.organizationId,x.userId,await readJson(request),key)},201)}
 if(request.method==='POST'&&p.length===2&&p[1]==='post'){const x=await authenticateFinance(runtime,request,'journals:write');return ok({data:await api.post(x.organizationId,x.userId,p[0])})}
 if(request.method==='POST'&&p.length===2&&p[1]==='reverse'){const x=await authenticateFinance(runtime,request,'journals:write');return ok({data:await api.reverse(x.organizationId,x.userId,p[0],await readJson(request))})}
 if(request.method==='DELETE'&&p.length===1){const x=await authenticateFinance(runtime,request,'journals:write');await api.remove(x.organizationId,x.userId,p[0]);return{status:204,body:null}}
 throw Object.assign(new Error('Finance journals route not found'),{status:404,code:'NOT_FOUND'});
}catch(error){if(error instanceof TypeError)throw Object.assign(error,{status:422,code:'VALIDATION_ERROR'});throw mapFinanceError(error)}}};
