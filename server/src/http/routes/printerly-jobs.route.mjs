import {authenticatePrinterly,data,header,httpifyPrinterlyError,readJson} from '../printerly-http.mjs';
const PREFIX='/api/v1/printerly/jobs';
const parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{
  name:'printerly-jobs',prefix:PREFIX,business:true,priority:90,
  enabled(config){return config.extensions?.printerly?.jobCutover==='node';},
  async handle({request,url,runtime,requestId}){try{
    const service=runtime.extensions?.printerly?.jobs;if(!service){const e=new Error('Printerly jobs self-hosted runtime is not ready');e.code='PRINTERLY_SELFHOST_NOT_READY';e.status=503;throw e;}
    const suffix=parts(url);
    if(request.method==='GET'&&suffix.length===0){const principal=await authenticatePrinterly(runtime,request);return data(await service.list(principal.organizationId,Number(url.searchParams.get('limit'))||100));}
    if(request.method==='POST'&&suffix.length===0){const principal=await authenticatePrinterly(runtime,request,{write:true}),body=await readJson(request),key=header(request,'Idempotency-Key')||String(body.idempotencyKey||'')||`request:${requestId}`;return data(await service.submit({principal,body,idempotencyKey:key}),201);}
    if(request.method==='POST'&&suffix.length===2&&suffix[1]==='release'){const principal=await authenticatePrinterly(runtime,request,{write:true});return data(await service.release({organizationId:principal.organizationId,userId:principal.userId,jobId:suffix[0]}));}
    if(request.method==='POST'&&suffix.length===2&&suffix[1]==='cancel'){const principal=await authenticatePrinterly(runtime,request,{write:true});return data(await service.cancel({organizationId:principal.organizationId,userId:principal.userId,jobId:suffix[0]}));}
    const e=new Error('Printerly jobs route not found');e.code='PRINTERLY_ROUTE_NOT_FOUND';e.status=404;throw e;
  }catch(error){throw httpifyPrinterlyError(error);}}
};
