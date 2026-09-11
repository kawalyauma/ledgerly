import {authenticatePrinterly,data,httpifyPrinterlyError} from '../printerly-http.mjs';
import {readPrinterlyMultipartFile} from '../../printerly/document-service.mjs';
const PREFIX='/api/v1/printerly/documents';
const parts=url=>url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
export default{
  name:'printerly-documents',prefix:PREFIX,business:true,priority:90,
  enabled(config){return config.extensions?.printerly?.jobCutover==='node';},
  async handle({request,url,runtime}){try{
    const service=runtime.extensions?.printerly?.documents;if(!service){const e=new Error('Printerly documents self-hosted runtime is not ready');e.code='PRINTERLY_SELFHOST_NOT_READY';e.status=503;throw e;}
    const suffix=parts(url);
    if(request.method==='POST'&&suffix.length===0){const principal=await authenticatePrinterly(runtime,request,{write:true}),file=await readPrinterlyMultipartFile(request);return data(await service.upload({organizationId:principal.organizationId,userId:principal.userId,file}),201);}
    if(request.method==='DELETE'&&suffix.length===1){const principal=await authenticatePrinterly(runtime,request,{write:true});return data(await service.remove({organizationId:principal.organizationId,documentId:suffix[0]}));}
    const e=new Error('Printerly documents route not found');e.code='PRINTERLY_ROUTE_NOT_FOUND';e.status=404;throw e;
  }catch(error){throw httpifyPrinterlyError(error);}}
};
