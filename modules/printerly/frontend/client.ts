import { del, get, post, uploadFile } from "../../../web/api";

export type PrinterlyPrinter={id:string;name:string;status:string;healthStatus?:string;location?:string;nodeName?:string};
export type CostProfile={currency:string;paperCostMinor:number;bwTonerCostMinor:number;colorTonerCostMinor:number;maintenanceCostMinor:number;electricityCostMinor:number;expenseAccountId?:string|null;offsetAccountId?:string|null;autoPostAccounting:boolean};
export type CostingOptions={projects:Array<{id:string;code:string;name:string}>;financeDepartments:Array<{id:string;code:string;name:string}>;schoolDepartments:Array<{id:string;code:string;name:string}>;accounts:Array<{id:string;code:string;name:string;type:string;subtype?:string}>;profile:CostProfile};
export type PrintJobOptions={
  title:string;printerId?:string|null;copies?:number;estimatedPages?:number;priority?:"urgent"|"high"|"normal"|"bulk";secureRelease?:boolean;
  pageSize?:"A4"|"A5"|"Letter"|"Legal";colorMode?:"monochrome"|"color";duplex?:boolean;
  projectId?:string|null;departmentType?:"finance"|"school"|null;departmentId?:string|null;sourceModule?:string|null;sourceReference?:string|null;
};

type UploadedDocument={id:string;originalName:string;mimeType:string;sizeBytes:number;checksum:string};

export async function sendFileToPrinterly(file:File,options:PrintJobOptions){
  let uploaded:UploadedDocument|undefined;
  try{
    uploaded=await uploadFile<UploadedDocument>("/printerly/documents",file,"printerly-print");
    return await post<any>("/printerly/jobs",{documentId:uploaded.id,title:options.title,printerId:options.printerId||null,copies:options.copies||1,estimatedPages:options.estimatedPages||1,
      priority:options.priority||"normal",secureRelease:Boolean(options.secureRelease),pageSize:options.pageSize||"A4",colorMode:options.colorMode||"monochrome",duplex:Boolean(options.duplex),
      projectId:options.projectId||null,departmentType:options.departmentType||null,departmentId:options.departmentId||null,sourceModule:options.sourceModule||null,sourceReference:options.sourceReference||null});
  }catch(error){if(uploaded?.id)await del(`/printerly/documents/${uploaded.id}`).catch(()=>{});throw error}
}

export async function sendBlobToPrinterly(blob:Blob,fileName:string,options:PrintJobOptions){
  return sendFileToPrinterly(new File([blob],fileName,{type:blob.type||"application/pdf"}),options);
}

export async function loadQuickPrintContext(){
  const[printers,costing]=await Promise.all([get<PrinterlyPrinter[]>("/printerly/printers"),get<CostingOptions>("/printerly/costing/options")]);
  return {printers,costing};
}

export function estimateCost(profile:CostProfile,pages:number,copies:number,duplex:boolean,colorMode:"monochrome"|"color"){
  const impressions=Math.max(1,pages)*Math.max(1,copies),sheets=duplex?Math.ceil(impressions/2):impressions;
  const paper=sheets*Number(profile.paperCostMinor||0),toner=impressions*Number(colorMode==="color"?profile.colorTonerCostMinor:profile.bwTonerCostMinor||0),maintenance=impressions*Number(profile.maintenanceCostMinor||0),electricity=impressions*Number(profile.electricityCostMinor||0);
  return {impressions,sheets,paper,toner,maintenance,electricity,total:paper+toner+maintenance+electricity,currency:profile.currency||"UGX"};
}
