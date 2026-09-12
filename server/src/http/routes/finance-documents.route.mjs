import {authenticateFinance,mapFinanceError,ok,pagination,readJson,requiredHeader,requireNodeCutover} from '../../finance/http.mjs';

const PREFIX='/api/v1/documents';
const parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);

export default{
  name:'finance-documents',
  prefix:PREFIX,
  business:true,
  priority:95,
  enabled(config){return config.extensions?.['finance-api']?.documentsReadCutover==='node';},
  async handle({request,url,runtime,requestId}){
    try{
      const ext=runtime.extensions?.['finance-api'];
      const api=ext?.core;
      if(!api)throw Object.assign(new Error('Finance documents runtime unavailable'),{status:503,code:'FINANCE_SELFHOST_NOT_READY'});
      const p=parts(url);

      if(request.method==='GET'&&p.length===0){
        const principal=await authenticateFinance(runtime,request,'documents:read');
        const page=pagination(url);
        return ok({data:await api.documents(principal.organizationId,{...page,status:url.searchParams.get('status'),documentType:url.searchParams.get('documentType')}),pagination:page});
      }
      if(request.method==='POST'&&p.length===0){
        const principal=await authenticateFinance(runtime,request,'documents:write');
        requireNodeCutover(ext,'documentsWriteCutover','FINANCE_DOCUMENTS_WRITE_NOT_CUT_OVER');
        const key=requiredHeader(request,'Idempotency-Key');
        return ok({data:await api.createDocument({principal,body:await readJson(request),idempotencyKey:key,requestId})},201);
      }
      if(request.method==='POST'&&p.length===2&&p[1]==='finalize'){
        const principal=await authenticateFinance(runtime,request,'documents:write');
        requireNodeCutover(ext,'documentsWriteCutover','FINANCE_DOCUMENTS_WRITE_NOT_CUT_OVER');
        return ok({data:await api.finalizeDocument({principal,documentId:p[0],body:await readJson(request,{optional:true}),requestId})});
      }
      if(request.method==='POST'&&p.length===2&&p[1]==='allocations'){
        const principal=await authenticateFinance(runtime,request,'documents:write');
        requireNodeCutover(ext,'documentsWriteCutover','FINANCE_DOCUMENTS_WRITE_NOT_CUT_OVER');
        const key=request.headers.get('Idempotency-Key');
        return ok({data:await api.allocateDocument({principal,documentId:p[0],body:await readJson(request),idempotencyKey:key,requestId})},201);
      }
      if(request.method==='POST'&&p.length===2&&p[1]==='reverse'){
        const principal=await authenticateFinance(runtime,request,'documents:write');
        requireNodeCutover(ext,'reversalsWriteCutover','FINANCE_REVERSAL_NOT_CUT_OVER');
        return ok({data:await api.reverseDocument({principal,documentId:p[0],body:await readJson(request),requestId})});
      }
      throw Object.assign(new Error('Finance documents route not found'),{status:404,code:'NOT_FOUND'});
    }catch(error){
      if(error instanceof TypeError)throw Object.assign(error,{status:422,code:'VALIDATION_ERROR'});
      throw mapFinanceError(error);
    }
  }
};
