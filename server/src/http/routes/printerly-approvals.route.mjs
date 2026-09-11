import {authenticatePrinterly,data,httpifyPrinterlyError,readJson} from '../printerly-http.mjs';
const PREFIX='/api/v1/printerly/approvals';
const parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{
  name:'printerly-approvals',prefix:PREFIX,business:true,priority:90,
  enabled(config){return config.extensions?.printerly?.jobCutover==='node';},
  async handle({request,url,runtime}){try{
    const service=runtime.extensions?.printerly?.approvals;if(!service){const e=new Error('Printerly approvals self-hosted runtime is not ready');e.code='PRINTERLY_SELFHOST_NOT_READY';e.status=503;throw e;}
    const suffix=parts(url),principal=await authenticatePrinterly(runtime,request);
    if(request.method==='GET'&&suffix.length===0)return data(await service.list(principal.organizationId,principal,url.searchParams.get('status')));
    if(request.method==='POST'&&suffix.length===2&&(suffix[1]==='approve'||suffix[1]==='reject')){const body=await readJson(request),decision=suffix[1]==='approve'?'approved':'rejected';return data(await service.decide({organizationId:principal.organizationId,principal,approvalId:suffix[0],decision,note:String(body.note||'')}));}
    const e=new Error('Printerly approvals route not found');e.code='PRINTERLY_ROUTE_NOT_FOUND';e.status=404;throw e;
  }catch(error){throw httpifyPrinterlyError(error);}}
};
