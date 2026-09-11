import { spawn } from "node:child_process";

const TEXT_TYPES=new Set(["text/plain","text/markdown","text/csv","application/json","application/xml","text/xml"]);
const TEXT_EXTENSIONS=new Set(["txt","md","markdown","csv","json","xml","html","htm"]);
const STORAGE_DOMAIN_PERMISSIONS=Object.freeze({
  academics:"academics:read",
  students:"students:read",
  student:"students:read",
  staff:"staff:read",
  finance:"finance:read",
  accounting:"finance:read",
  receipts:"finance:read",
  fees:"fees:read",
  payroll:"payroll:read",
  inventory:"inventory:read",
  school:"school:read",
  documents:"documents:read",
  reports:"reports:read",
  communications:"communications:read",
  tasks:"tasks:read",
  support:"support:read",
  books:"school:read",
  attendance:"school:read",
  printerly:"documents:read",
  nvr:"admin:read",
  security:"admin:read",
});

function storageDomainPermission(storageRef){
  const raw=String(storageRef??"").replaceAll("\\","/");
  const parts=raw.split("/").filter(Boolean);
  if(parts.some((part)=>part==="."||part==="..")){const error=new Error("knowledge storage reference may not contain traversal segments");error.code="AI_KNOWLEDGE_STORAGE_REF_INVALID";throw error;}
  const first=String(parts[0]??"").toLowerCase(),second=String(parts[1]??"").toLowerCase();
  if(first==="ai"&&second==="knowledge")return null;
  return STORAGE_DOMAIN_PERMISSIONS[first]??"admin:read";
}

function assertIngestionAuthority(context,{domainPermission,requiredPermissions=[]}={}){
  const granted=new Set(Array.isArray(context?.permissions)?context.permissions.filter((item)=>typeof item==="string"):[]);
  if(granted.has("*"))return;
  const required=["ai:knowledge:write","ai:knowledge:read",...(domainPermission?[domainPermission]:[]),...(Array.isArray(requiredPermissions)?requiredPermissions:[])];
  const missing=[...new Set(required.filter((permission)=>typeof permission==="string"&&permission.trim()&&!granted.has(permission.trim())))];
  if(missing.length){
    const error=new Error("AI knowledge ingestion exceeds current authority");
    error.status=403;
    error.code="AI_KNOWLEDGE_PERMISSION_DENIED";
    error.details={missingPermissions:missing};
    throw error;
  }
}

export class AiKnowledgeIngestionService{
  constructor({knowledge,storageForOrganization,audit,pdfExtractor=extractPdfLocally,maxBytes=25*1024*1024,chunkChars=3200,overlapChars=400}){
    if(typeof storageForOrganization!=="function")throw new TypeError("AI knowledge ingestion requires tenant-scoped storage");
    this.knowledge=knowledge;this.storageForOrganization=storageForOrganization;this.audit=audit;this.pdfExtractor=pdfExtractor;this.maxBytes=maxBytes;this.chunkChars=chunkChars;this.overlapChars=overlapChars;
  }

  async ingestStored({context,name,sourceType="uploaded_document",storageRef,contentType=null,metadata={},requiredPermissions=[]}){
    if(!context?.organizationId)throw new Error("organization context required");
    if(!context?.userId)throw new Error("knowledge ingestion requires an attributable requester");
    if(!storageRef)throw new Error("storageRef is required");
    const domainPermission=storageDomainPermission(storageRef);
    assertIngestionAuthority(context,{domainPermission,requiredPermissions});
    const classification=[...(Array.isArray(requiredPermissions)?requiredPermissions:[]),...(domainPermission?[domainPermission]:[])];
    const storage=this.storageForOrganization(context.organizationId);
    const head=await storage.head(storageRef);if(!head)throw new Error("knowledge source object not found");
    if(Number(head.size)>this.maxBytes){const error=new Error(`Knowledge source exceeds ${this.maxBytes} byte limit`);error.code="AI_KNOWLEDGE_FILE_TOO_LARGE";throw error;}
    const bytes=await storage.get(storageRef);
    const detected=contentType||head.metadata?.["content-type"]||head.metadata?.contentType||inferContentType(storageRef);
    const text=await extractText({bytes,contentType:detected,storageRef,pdfExtractor:this.pdfExtractor});
    const normalized=normalizeText(text);if(!normalized){const error=new Error("No extractable text found in knowledge source");error.code="AI_KNOWLEDGE_EMPTY";throw error;}
    const chunks=chunkText(normalized,{chunkChars:this.chunkChars,overlapChars:this.overlapChars}).map((content,index)=>({content,tokenCount:estimateTokens(content),metadata:{source_name:name,storage_ref:storageRef,content_type:detected,chunk:index}}));
    const source=await this.knowledge.createSource({context,name,sourceType,storageRef,requiredPermissions:classification,metadata:{...metadata,contentType:detected,size:Number(head.size),extraction:"local",tenantScoped:true,storageDomainPermission:domainPermission}});
    const indexed=await this.knowledge.indexChunks({context,sourceId:source.source_id,chunks});
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.knowledge.ingested",entity_type:"ai_knowledge_source",entity_id:source.source_id,metadata:{storage_ref:storageRef,chunks:chunks.length,bytes:Number(head.size),content_type:detected,tenant_scoped:true,required_permissions:source.required_permissions??classification,storage_domain_permission:domainPermission}});
    return {source:{...source,status:"indexed"},chunks:chunks.length,indexed};
  }
}

export function chunkText(text,{chunkChars=3200,overlapChars=400}={}){
  if(chunkChars<500)throw new TypeError("chunkChars must be at least 500");
  if(overlapChars<0||overlapChars>=chunkChars)throw new TypeError("overlapChars must be >= 0 and smaller than chunkChars");
  const paragraphs=normalizeText(text).split(/\n{2,}/).filter(Boolean),chunks=[];let current="";
  const push=()=>{const value=current.trim();if(value)chunks.push(value);current="";};
  for(const paragraph of paragraphs){
    if(paragraph.length>chunkChars){push();let start=0;while(start<paragraph.length){const piece=paragraph.slice(start,start+chunkChars).trim();if(piece)chunks.push(piece);if(start+chunkChars>=paragraph.length)break;start+=chunkChars-overlapChars;}continue;}
    const candidate=current?`${current}\n\n${paragraph}`:paragraph;
    if(candidate.length<=chunkChars){current=candidate;continue;}
    const previous=current;push();
    const overlap=previous?previous.slice(Math.max(0,previous.length-overlapChars)).trim():"";
    current=overlap?`${overlap}\n\n${paragraph}`:paragraph;
  }
  push();return chunks;
}

export async function extractText({bytes,contentType,storageRef,pdfExtractor=extractPdfLocally}){
  const ext=String(storageRef||"").split(".").pop()?.toLowerCase()||"";
  if(contentType==="application/pdf"||ext==="pdf")return pdfExtractor(bytes);
  if(TEXT_TYPES.has(contentType)||TEXT_EXTENSIONS.has(ext))return Buffer.from(bytes).toString("utf8");
  const error=new Error(`Unsupported knowledge document type: ${contentType||ext||"unknown"}`);error.code="AI_KNOWLEDGE_TYPE_UNSUPPORTED";throw error;
}

export function extractPdfLocally(bytes){
  return new Promise((resolve,reject)=>{
    const child=spawn("pdftotext",["-","-"],{stdio:["pipe","pipe","pipe"]});const out=[],err=[];
    let settled=false;
    const finishError=(error)=>{if(settled)return;settled=true;reject(error);};
    child.stdout.on("data",(chunk)=>out.push(chunk));child.stderr.on("data",(chunk)=>err.push(chunk));
    child.once("error",(cause)=>{const error=new Error("Local PDF extraction is unavailable. Install poppler-utils/pdftotext on the Ledgerly server.");error.code="AI_PDF_EXTRACTOR_UNAVAILABLE";error.cause=cause;finishError(error);});
    child.once("close",(code)=>{if(settled)return;if(code!==0){const error=new Error(`PDF extraction failed: ${Buffer.concat(err).toString("utf8").trim()||`exit ${code}`}`);error.code="AI_PDF_EXTRACTION_FAILED";finishError(error);return;}settled=true;resolve(Buffer.concat(out).toString("utf8"));});
    child.stdin.on("error",()=>undefined);
    child.stdin.end(Buffer.from(bytes));
  });
}
function normalizeText(value){return String(value??"").replace(/\r\n?/g,"\n").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();}
function estimateTokens(value){return Math.ceil(String(value).length/4);}
function inferContentType(key){const ext=String(key).split(".").pop()?.toLowerCase();if(ext==="pdf")return"application/pdf";if(ext==="json")return"application/json";if(ext==="csv")return"text/csv";if(ext==="md"||ext==="markdown")return"text/markdown";if(ext==="xml")return"application/xml";return"text/plain";}
