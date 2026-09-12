import {authenticateFinance,mapFinanceError,ok,readJson} from '../../finance/http.mjs';
const PREFIX='/api/v1/tax',parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{name:'finance-tax',prefix:PREFIX,business:true,priority:90,enabled:c=>c.extensions?.['finance-api']?.taxCutover==='node',async handle({request,url,runtime}){try{const api=runtime.extensions?.['finance-api']?.tax;if(!api)throw Object.assign(new Error('Finance tax runtime unavailable'),{status:503,code:'FINANCE_SELFHOST_NOT_READY'});const p=parts(url);
 if(request.method==='GET'&&p.length===1&&p[0]==='jurisdictions'){const x=await authenticateFinance(runtime,request,'accounts:read');return ok({data:await api.jurisdictions(x.organizationId)})}
 if(request.method==='POST'&&p.length===1&&p[0]==='jurisdictions'){const x=await authenticateFinance(runtime,request,'accounts:write');return ok({data:await api.createJurisdiction(x.organizationId,x.userId,await readJson(request))},201)}
 if(request.method==='GET'&&p.length===1&&p[0]==='codes'){const x=await authenticateFinance(runtime,request,'accounts:read');return ok({data:await api.codes(x.organizationId)})}
 if(request.method==='POST'&&p.length===1&&p[0]==='codes'){const x=await authenticateFinance(runtime,request,'accounts:write');return ok({data:await api.createCode(x.organizationId,x.userId,await readJson(request))},201)}
 if(request.method==='PUT'&&p.length===2&&p[0]==='codes'){const x=await authenticateFinance(runtime,request,'accounts:write');return ok({data:await api.updateCode(x.organizationId,x.userId,p[1],await readJson(request))})}
 if(request.method==='POST'&&p.length===1&&p[0]==='exemptions'){const x=await authenticateFinance(runtime,request,'accounts:write');return ok({data:await api.createExemption(x.organizationId,x.userId,await readJson(request))},201)}
 if(request.method==='GET'&&p.length===1&&p[0]==='returns'){const x=await authenticateFinance(runtime,request,'reports:read');return ok({data:await api.returns(x.organizationId)})}
 if(request.method==='POST'&&p.length===2&&p[0]==='returns'&&p[1]==='prepare'){const x=await authenticateFinance(runtime,request,'reports:write');return ok({data:await api.prepareReturn(x.organizationId,x.userId,await readJson(request))},201)}
 if(request.method==='POST'&&p.length===3&&p[0]==='returns'&&p[2]==='lock'){const x=await authenticateFinance(runtime,request,'reports:write');return ok({data:await api.lockReturn(x.organizationId,x.userId,p[1])})}
 if(request.method==='POST'&&p.length===3&&p[0]==='returns'&&p[2]==='file'){const x=await authenticateFinance(runtime,request,'reports:write');return ok({data:await api.fileReturn(x.organizationId,x.userId,p[1],await readJson(request))})}
 throw Object.assign(new Error('Tax route not found'),{status:404,code:'NOT_FOUND'});
 }catch(error){if(error instanceof TypeError)throw Object.assign(error,{status:422,code:'VALIDATION_ERROR'});throw mapFinanceError(error)}}};
