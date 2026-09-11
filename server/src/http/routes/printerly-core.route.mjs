import {authenticatePrinterly,data,httpifyPrinterlyError,readJson} from '../printerly-http.mjs';
const P='/api/v1/printerly';
const err=()=>Object.assign(new Error('Printerly route not found'),{code:'PRINTERLY_ROUTE_NOT_FOUND',status:404});
export default{name:'printerly-core',prefix:`${P}/manifest`,business:true,priority:87,enabled(c){return c.extensions?.printerly?.coreCutover==='node';},async handle({request,url,runtime}){try{if(request.method==='GET'&&url.pathname===`${P}/manifest`)return data(await runtime.extensions.printerly.management.manifest());throw err();}catch(e){throw httpifyPrinterlyError(e);}}};
