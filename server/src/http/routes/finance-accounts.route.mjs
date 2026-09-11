import {authenticateFinance,mapFinanceError,ok,pagination,readJson} from '../../finance/http.mjs';
const PREFIX='/api/v1/accounts',parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{name:'finance-accounts',prefix:PREFIX,business:true,priority:95,enabled(config){return config.extensions?.['finance-api']?.referenceCutover==='node'},async handle({request,url,runtime}){try{const api=runtime.extensions?.['finance-api']?.accounts;if(!api)throw Object.assign(new Error('Finance accounts runtime unavailable'),{status:503,code:'FINANCE_SELFHOST_NOT_READY'});const p=parts(url);
 if(request.method==='GET'&&p.length===0){const x=await authenticateFinance(runtime,request,'accounts:read'),page=pagination(url);return ok({data:await api.list(x.organizationId,page),pagination:page})}
 if(request.method==='POST'&&p.length===0){const x=await authenticateFinance(runtime,request,'accounts:write');return ok({data:await api.create(x.organizationId,x.userId,await readJson(request))},201)}
 if(request.method==='GET'&&p.length===1&&p[0]==='groups'){const x=await authenticateFinance(runtime,request,'accounts:read');return ok({data:await api.groups(x.organizationId)})}
 if(request.method==='PUT'&&p.length===1){const x=await authenticateFinance(runtime,request,'accounts:write');return ok({data:await api.update(x.organizationId,x.userId,p[0],await readJson(request))})}
 if(request.method==='PATCH'&&p.length===2&&p[1]==='active'){const x=await authenticateFinance(runtime,request,'accounts:write'),body=await readJson(request);return ok({data:await api.active(x.organizationId,x.userId,p[0],body.active)})}
 if(request.method==='DELETE'&&p.length===1){const x=await authenticateFinance(runtime,request,'accounts:write');await api.remove(x.organizationId,x.userId,p[0]);return{status:204,body:null}}
 throw Object.assign(new Error('Finance accounts route not found'),{status:404,code:'NOT_FOUND'});
}catch(error){if(error instanceof TypeError)throw Object.assign(error,{status:422,code:'VALIDATION_ERROR'});throw mapFinanceError(error)}}};
