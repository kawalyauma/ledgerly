import {authenticateFinance,mapFinanceError,ok,readJson} from '../../finance/http.mjs';
const PREFIX='/api/v1/payroll',parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
const SUPPORTED=[
  ['GET',/^\/manifest$/],['GET',/^\/workforce$/],['GET',/^\/employees$/],['POST',/^\/employees$/],
  ['GET',/^\/runs$/],['POST',/^\/runs$/],['GET',/^\/runs\/[^/]+\/lines$/],['POST',/^\/runs\/[^/]+\/approve$/],['POST',/^\/runs\/[^/]+\/post$/],['POST',/^\/runs\/[^/]+\/(?:reverse|reverse-safe)$/],
  ['GET',/^\/runs\/[^/]+\/payslips\/[^/]+$/],['GET',/^\/runs\/[^/]+\/payslips\/[^/]+\/pdf$/],['POST',/^\/runs\/[^/]+\/payslips\/[^/]+\/deliver$/],
  ['GET',/^\/components$/],['POST',/^\/components$/],['PATCH',/^\/components\/[^/]+$/],
  ['GET',/^\/rules$/],['POST',/^\/rules$/],['PATCH',/^\/rules\/[^/]+$/],
  ['GET',/^\/inputs$/],['POST',/^\/inputs$/],
  ['POST',/^\/runs\/[^/]+\/payment-batches$/],['GET',/^\/payment-batches$/],['POST',/^\/payment-batches\/[^/]+\/approve$/],['POST',/^\/payment-batches\/[^/]+\/(?:process|process-safe)$/],
  ['GET',/^\/statutory-returns$/],['POST',/^\/statutory-returns$/],['PATCH',/^\/statutory-returns\/[^/]+\/status$/],
  ['GET',/^\/year-end\/[^/]+\/statements$/],
];
function matches({request,url}){const relative=url.pathname.slice(PREFIX.length)||'/';return SUPPORTED.some(([method,pattern])=>request.method===method&&pattern.test(relative));}
export default{name:'payroll-finance',prefix:PREFIX,business:true,priority:95,enabled:c=>c.extensions?.['finance-api']?.payrollCutover==='node',matches,async handle({request,url,runtime}){try{const api=runtime.extensions?.['finance-api']?.payrollManagement;if(!api)throw Object.assign(new Error('Payroll runtime unavailable'),{status:503,code:'FINANCE_SELFHOST_NOT_READY'});const p=parts(url),scope=request.method==='GET'?'payroll:read':'payroll:write',x=await authenticateFinance(runtime,request,scope),org=x.organizationId,user=x.userId;
if(request.method==='GET'&&p.length===1&&p[0]==='manifest')return ok({data:await api.manifest(org)});
if(request.method==='GET'&&p.length===1&&p[0]==='workforce')return ok({data:await api.workforce(org)});
if(request.method==='GET'&&p.length===1&&p[0]==='employees')return ok({data:await api.employees(org)});
if(request.method==='POST'&&p.length===1&&p[0]==='employees')return ok({data:await api.createEmployee(org,user,await readJson(request))},201);
if(request.method==='GET'&&p.length===1&&p[0]==='runs')return ok({data:await api.runs(org)});
if(request.method==='POST'&&p.length===1&&p[0]==='runs')return ok({data:await api.createRun(org,user,await readJson(request))},201);
if(request.method==='GET'&&p.length===3&&p[0]==='runs'&&p[2]==='lines')return ok({data:await api.runLines(org,p[1])});
if(request.method==='POST'&&p.length===3&&p[0]==='runs'&&p[2]==='approve')return ok({data:await api.approveRun(org,user,p[1])});
if(request.method==='POST'&&p.length===3&&p[0]==='runs'&&p[2]==='post')return ok({data:await api.postRun(org,user,p[1],await readJson(request))});
if(request.method==='POST'&&p.length===3&&p[0]==='runs'&&(p[2]==='reverse'||p[2]==='reverse-safe'))return ok({data:await api.reverseRun(org,user,p[1],await readJson(request))});
if(request.method==='GET'&&p.length===4&&p[0]==='runs'&&p[2]==='payslips')return ok({data:await api.payslip(org,p[1],p[3])});
if(request.method==='GET'&&p.length===5&&p[0]==='runs'&&p[2]==='payslips'&&p[4]==='pdf'){const file=await api.payslipPdf(org,p[1],p[3]);return{status:200,rawBody:file.bytes,headers:{'content-type':'application/pdf','content-disposition':`attachment; filename=${file.filename}`}};}
if(request.method==='POST'&&p.length===5&&p[0]==='runs'&&p[2]==='payslips'&&p[4]==='deliver')return ok({data:await api.deliverPayslip(org,user,p[1],p[3],await readJson(request))},202);
if(request.method==='GET'&&p.length===1&&p[0]==='components')return ok({data:await api.components(org)});
if(request.method==='POST'&&p.length===1&&p[0]==='components')return ok({data:await api.createComponent(org,await readJson(request))},201);
if(request.method==='PATCH'&&p.length===2&&p[0]==='components')return ok({data:await api.updateComponent(org,p[1],await readJson(request))});
if(request.method==='GET'&&p.length===1&&p[0]==='rules')return ok({data:await api.rules(org)});
if(request.method==='POST'&&p.length===1&&p[0]==='rules')return ok({data:await api.createRule(org,await readJson(request))},201);
if(request.method==='PATCH'&&p.length===2&&p[0]==='rules')return ok({data:await api.updateRule(org,p[1],await readJson(request))});
if(request.method==='GET'&&p.length===1&&p[0]==='inputs')return ok({data:await api.inputs(org)});
if(request.method==='POST'&&p.length===1&&p[0]==='inputs')return ok({data:await api.createInputs(org,await readJson(request))},201);
if(request.method==='POST'&&p.length===3&&p[0]==='runs'&&p[2]==='payment-batches')return ok({data:await api.createBatch(org,user,p[1],await readJson(request))},201);
if(request.method==='GET'&&p.length===1&&p[0]==='payment-batches')return ok({data:await api.paymentBatches(org,url.searchParams.get('runId')||null)});
if(request.method==='POST'&&p.length===3&&p[0]==='payment-batches'&&p[2]==='approve')return ok({data:await api.approveBatch(org,user,p[1])});
if(request.method==='POST'&&p.length===3&&p[0]==='payment-batches'&&(p[2]==='process'||p[2]==='process-safe'))return ok({data:await api.processBatch(org,user,p[1],await readJson(request,{optional:true}))});
if(request.method==='GET'&&p.length===1&&p[0]==='statutory-returns')return ok({data:await api.statutoryReturns(org,url.searchParams.get('year')||null)});
if(request.method==='POST'&&p.length===1&&p[0]==='statutory-returns')return ok({data:await api.createStatutory(org,await readJson(request))},201);
if(request.method==='PATCH'&&p.length===3&&p[0]==='statutory-returns'&&p[2]==='status'){const body=await readJson(request);return ok({data:await api.statutoryStatus(org,user,p[1],body.status)});}
if(request.method==='GET'&&p.length===3&&p[0]==='year-end'&&p[2]==='statements')return ok({data:await api.yearEnd(org,p[1])});
throw Object.assign(new Error('Payroll route not found'),{status:404,code:'NOT_FOUND'});}catch(error){if(error instanceof TypeError)throw Object.assign(error,{status:422,code:'VALIDATION_ERROR'});throw mapFinanceError(error)}}};
