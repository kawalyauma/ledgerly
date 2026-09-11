import {authenticatePrinterly,data,httpifyPrinterlyError} from '../printerly-http.mjs';
const PREFIX='/api/v1/printerly/scannerly';
const parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{
  name:'printerly-scannerly',prefix:PREFIX,business:true,priority:88,
  enabled(config){return config.extensions?.printerly?.scannerCutover==='node';},
  async handle({request,url,runtime}){try{const service=runtime.extensions?.printerly?.scanner;if(!service){const e=new Error('Scannerly self-hosted runtime is not ready');e.code='PRINTERLY_SCANNER_SELFHOST_NOT_READY';e.status=503;throw e;}const p=await authenticatePrinterly(runtime,request),suffix=parts(url);if(request.method==='GET'&&suffix.join('/')==='targets')return data(await service.targets(p.organizationId,url.searchParams.get('q')||''));if(request.method==='GET'&&suffix.join('/')==='inbox')return data(await service.inbox(p.organizationId,url.searchParams.get('module')||'',Number(url.searchParams.get('limit'))||80));const e=new Error('Scannerly route not found');e.code='PRINTERLY_ROUTE_NOT_FOUND';e.status=404;throw e;}catch(error){throw httpifyPrinterlyError(error);}}
};
