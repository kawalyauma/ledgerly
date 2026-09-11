import { spawn } from "node:child_process";

const TEXT_TYPES=new Set(["text/plain","text/markdown","text/csv","application/json","application/xml","text/xml","text/html"]);
const TEXT_EXTENSIONS=new Set(["txt","md","markdown","csv","json","xml","html","htm"]);
const DEFAULT_MAX_CHUNKS=1000;

export class AiKnowledgeIngestionService{
  constructor({knowledge,storage=null,storageForContext=null,audit,pdfExtractor=extractPdfLocally,maxBytes=25*1024*1024,chunkChars=3200,overlapChars=400,maxChunks=DEFAULT_MAX_CHUNKS}){
    this.knowledge=knowledge;this.storage=storage;this.storageForContext=storageForContext;this.audit=audit;this.pdfExtractor=pdfExtractor;this.maxBytes=maxBytes;this.chunkChars=chunkChars;this.overlapChars=overlapChars;this.maxChunks=Math.max(1,Number(maxChunks)||DEFAULT_MAX_CHUNKS);
  }

  #storage(context){const resolved=this.storageForContext?.(context)??this.storage;if(!resolved)throw new Error("Tenant-scoped knowledge storage is unavailable");return resolved;}

  async ingestStored({context,name,sourceType="uploaded_document",storageRef,contentType=null,metadata={}}){
    if(!context?.organizationId)throw new Error("organization context required");
    if(!storageRef)throw new Error("storageRef is required");
    const storage=this.#storage(context);
    const head=await storage.head(storageRef);if(!head)throw new Error("knowledge source object not found");
    if(Number(head.size)>this.maxBytes){const error=new Error(`Knowledge source exceeds ${this.maxBytes} byte limit`);error.code="AI_KNOWLEDGE_FILE_TOO_LARGE";throw error;}
    const bytes=await storage.get(storageRef);
    const detected=contentType||head.metadata?.["content-type"]||head.metadata?.contentType||inferContentType(storageRef);
    const text=await extractText({bytes,contentType:detected,storageRef,pdfExtractor:this.pdfExtractor});
    const normalized=normalizeText(text);if(!normalized){const error=new Error("No extractable text found in knowledge source");error.code="AI_KNOWLEDGE_EMPTY";throw error;}
    const pieces=chunkText(normalized,{chunkChars:this.chunkChars,overlapChars:this.overlapChars});if(pieces.length>this.maxChunks){const error=new Error(`Knowledge source expands to ${pieces.length} chunks; maximum is ${this.maxChunks}`);error.code="AI_KNOWLEDGE_TOO_MANY_CHUNKS";error.status=422;throw error;}
    const chunks=pieces.map((content,index)=>({content,tokenCount:estimateTokens(content),metadata:{source_name:name,storage_ref:storageRef,content_type:detected,chunk:index}}));
    const source=await this.knowledge.createSource({context,name,sourceType,storageRef,metadata:{...metadata,contentType:detected,size:Number(head.size),extraction:"local"}});
    const indexed=await this.knowledge.indexChunks({context,sourceId:source.source_id,chunks});
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.knowledge.ingested",entity_type:"ai_knowledge_source",entity_id:source.source_id,metadata:{storage_ref:storageRef,chunks:chunks.length,bytes:Number(head.size),content_type:detected,tenant_scoped:true}});
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

export function extractPdfLocally(bytes,{timeoutMs=30000,maxOutputBytes=20*1024*1024,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    const child=spawnImpl("pdftotext",["-","-"],{stdio:["pipe","pipe","pipe"]});const out=[],err=[];let outBytes=0,settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};
    const fail=(code,message,cause=null)=>{const error=new Error(message);error.code=code;if(cause)error.cause=cause;finish(reject,error);};
    const timer=setTimeout(()=>{child.kill?.("SIGKILL");fail("AI_PDF_EXTRACTION_TIMEOUT",`PDF extraction exceeded ${timeoutMs} ms`);},timeoutMs);
    child.stdout.on("data",(chunk)=>{if(settled)return;outBytes+=chunk.length;if(outBytes>maxOutputBytes){child.kill?.("SIGKILL");fail("AI_PDF_EXTRACTION_OUTPUT_TOO_LARGE",`PDF extracted text exceeds ${maxOutputBytes} bytes`);return;}out.push(chunk);});
    child.stderr.on("data",(chunk)=>{if(!settled&&Buffer.concat(err).length<64*1024)err.push(chunk);});
    child.once("error",(cause)=>fail("AI_PDF_EXTRACTOR_UNAVAILABLE","Local PDF extraction is unavailable. Install poppler-utils/pdftotext on the Ledgerly server.",cause));
    child.once("close",(code)=>{if(settled)return;if(code!==0){fail("AI_PDF_EXTRACTION_FAILED",`PDF extraction failed: ${Buffer.concat(err).toString("utf8").trim()||`exit ${code}`}`);return;}finish(resolve,Buffer.concat(out).toString("utf8"));});
    child.stdin.on?.("error",()=>{});
    child.stdin.end(Buffer.from(bytes));
  });
}
function normalizeText(value){return String(value??"").replace(/\r\n?/g,"\n").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();}
function estimateTokens(value){return Math.ceil(String(value).length/4);}
function inferContentType(key){const ext=String(key).split(".").pop()?.toLowerCase();if(ext==="pdf")return"application/pdf";if(ext==="json")return"application/json";if(ext==="csv")return"text/csv";if(ext==="md"||ext==="markdown")return"text/markdown";if(ext==="xml")return"application/xml";if(ext==="html"||ext==="htm")return"text/html";return"text/plain";}
