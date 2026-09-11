import {authenticatePrinterly,data,httpifyPrinterlyError,readJson} from '../printerly-http.mjs';
const PREFIX='/api/v1/printerly/scans';
const parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{
  name:'printerly-scans',prefix:PREFIX,business:true,priority:88,
  enabled(config){return config.extensions?.printerly?.scannerCutover==='node';},
  async handle({request,url,runtime}){try{
    const service=runtime.extensions?.printerly?.scanner;if(!service){const e=new Error('Scannerly self-hosted runtime is not ready');e.code='PRINTERLY_SCANNER_SELFHOST_NOT_READY';e.status=503;throw e;}
    const suffix=parts(url);
    if(request.method==='GET'&&suffix.length===0){const p=await authenticatePrinterly(runtime,request);return data(await service.list(p.organizationId,Number(url.searchParams.get('limit'))||150));}
    if(request.method==='POST'&&suffix.length===0){const p=await authenticatePrinterly(runtime,request,{write:true});return data(await service.create({organizationId:p.organizationId,userId:p.userId,data:await readJson(request)}),201);}
    if(request.method==='POST'&&suffix.length===2&&suffix[1]==='cancel'){const p=await authenticatePrinterly(runtime,request,{write:true});return data(await service.cancel({organizationId:p.organizationId,userId:p.userId,scanJobId:suffix[0]}));}
    if(request.method==='POST'&&suffix.length===2&&suffix[1]==='retry'){const p=await authenticatePrinterly(runtime,request,{write:true});return data(await service.retry({organizationId:p.organizationId,userId:p.userId,scanJobId:suffix[0]}));}
    if(request.method==='GET'&&suffix.length===3&&suffix[0]==='documents'&&suffix[2]==='content'){const p=await authenticatePrinterly(runtime,request);const file=await service.getDocument(p.organizationId,suffix[1]);return{status:200,rawBody:file.bytes,headers:{'content-type':file.mimeType,'content-length':String(file.bytes.length),'content-disposition':`inline; filename="${String(file.originalName||'scan').replace(/["\r\n]/g,'-')}"`,'x-printerly-sha256':file.checksum}};}
    const e=new Error('Scannerly route not found');e.code='PRINTERLY_ROUTE_NOT_FOUND';e.status=404;throw e;
  }catch(error){throw httpifyPrinterlyError(error);}}
};
