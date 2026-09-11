import {authenticatePrinterly,data,httpifyPrinterlyError} from '../printerly-http.mjs';
const PREFIX='/api/v1/printerly/scanners';
export default{
  name:'printerly-scanners',prefix:PREFIX,business:true,priority:88,
  enabled(config){return config.extensions?.printerly?.scannerCutover==='node';},
  async handle({request,url,runtime}){try{const service=runtime.extensions?.printerly?.scanner;if(!service){const e=new Error('Scannerly self-hosted runtime is not ready');e.code='PRINTERLY_SCANNER_SELFHOST_NOT_READY';e.status=503;throw e;}if(request.method==='GET'&&url.pathname===PREFIX){const p=await authenticatePrinterly(runtime,request);return data(await service.listScanners(p.organizationId));}const e=new Error('Scannerly scanner route not found');e.code='PRINTERLY_ROUTE_NOT_FOUND';e.status=404;throw e;}catch(error){throw httpifyPrinterlyError(error);}}
};
