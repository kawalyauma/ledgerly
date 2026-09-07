import { Hono } from "hono";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import type { AppVariables, Env } from "../../../../src/types";
import { requireScope } from "../../../../src/lib/auth";
import { AppError } from "../../../../src/lib/errors";
import { createId } from "../../../../src/lib/ids";
import { camelizeRows, schoolPermission } from "../common";
import { studentBalance } from "./common";

type AnyRow = Record<string, any>;

type ReceiptSnapshotRow = {
  receiptId: string;
  organizationId: string;
  snapshotVersion: number;
  finalized: number;
  amountWords: string;
  balanceBeforeMinor: number | null;
  balanceAfterMinor: number | null;
  snapshotJson: string;
  contentHash: string;
  capturedAt: string;
  finalizedAt: string | null;
};

export type ReceiptArchive = {
  snapshotVersion: number;
  finalized: boolean;
  amountWords: string;
  balanceBeforeMinor: number | null;
  balanceAfterMinor: number | null;
  contentHash: string;
  capturedAt: string;
  finalizedAt: string | null;
  snapshot: AnyRow;
};

const ones = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
const scales: Array<[number,string]> = [[1_000_000_000_000,"trillion"],[1_000_000_000,"billion"],[1_000_000,"million"],[1_000,"thousand"]];

function integerWords(value:number):string {
  const n=Math.floor(Math.abs(value));
  if(n<20)return ones[n]!;
  if(n<100)return `${tens[Math.floor(n/10)]}${n%10?`-${ones[n%10]}`:""}`;
  if(n<1000)return `${ones[Math.floor(n/100)]} hundred${n%100?` ${integerWords(n%100)}`:""}`;
  for(const [size,label] of scales) if(n>=size){const whole=Math.floor(n/size),rest=n%size;return `${integerWords(whole)} ${label}${rest?` ${integerWords(rest)}`:""}`;}
  return String(n);
}
function titleWords(value:string){return value.replace(/\b\w/g,c=>c.toUpperCase());}
export function amountInWords(amountMinor:number,currency:string){
  const code=String(currency||"UGX").toUpperCase(),negative=amountMinor<0,absolute=Math.abs(Math.trunc(amountMinor)),whole=Math.floor(absolute/100),fraction=absolute%100;
  const names:Record<string,[string,string,string,string]>={UGX:["Uganda Shilling","Uganda Shillings","Cent","Cents"],USD:["US Dollar","US Dollars","Cent","Cents"],KES:["Kenyan Shilling","Kenyan Shillings","Cent","Cents"],TZS:["Tanzanian Shilling","Tanzanian Shillings","Cent","Cents"],RWF:["Rwandan Franc","Rwandan Francs","Centime","Centimes"]};
  const [one,many,centOne,centMany]=names[code]||[code,code,"Cent","Cents"];
  let text=`${integerWords(whole)} ${whole===1?one:many}`;
  if(fraction>0&&code!=="UGX")text+=` and ${integerWords(fraction)} ${fraction===1?centOne:centMany}`;
  return `${negative?"Minus ":""}${titleWords(text)} Only`;
}
function parseJson<T>(value:unknown,fallback:T):T{try{return typeof value==="string"?JSON.parse(value) as T:fallback}catch{return fallback}}
async function sha256(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");}
function dbArchive(row:ReceiptSnapshotRow):ReceiptArchive{return{snapshotVersion:Number(row.snapshotVersion||1),finalized:Boolean(row.finalized),amountWords:row.amountWords,balanceBeforeMinor:row.balanceBeforeMinor==null?null:Number(row.balanceBeforeMinor),balanceAfterMinor:row.balanceAfterMinor==null?null:Number(row.balanceAfterMinor),contentHash:row.contentHash,capturedAt:row.capturedAt,finalizedAt:row.finalizedAt,snapshot:parseJson(row.snapshotJson,{})};}

async function loadStoredArchive(db:D1Database,org:string,receiptId:string){
  const row=await db.prepare(`SELECT receipt_id AS receiptId,organization_id AS organizationId,snapshot_version AS snapshotVersion,finalized,amount_words AS amountWords,balance_before_minor AS balanceBeforeMinor,balance_after_minor AS balanceAfterMinor,snapshot_json AS snapshotJson,content_hash AS contentHash,captured_at AS capturedAt,finalized_at AS finalizedAt FROM school_fee_receipt_snapshots WHERE receipt_id=? AND organization_id=?`).bind(receiptId,org).first<ReceiptSnapshotRow>();
  return row?dbArchive(row):null;
}

async function receiptSource(db:D1Database,org:string,receiptId:string){
  const row=await db.prepare(`SELECT
    r.id,r.receipt_number AS receiptNumber,r.student_id AS studentId,r.payer_contact_id AS payerContactId,r.payment_id AS paymentId,
    r.payment_date AS paymentDate,r.currency,r.amount_minor AS amountMinor,r.allocated_minor AS allocatedMinor,r.unallocated_minor AS unallocatedMinor,
    r.reference,r.notes,r.status,r.created_at AS createdAt,r.updated_at AS updatedAt,
    p.created_at AS paymentCreatedAt,
    ct.name AS payerName,pm.name AS paymentMethodName,pm.code AS paymentMethodCode,
    s.admission_number AS admissionNumber,s.student_number AS studentNumber,
    s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,
    cl.name AS className,st.name AS streamName,
    u.display_name AS receivedBy,
    o.name AS organizationName,o.legal_name AS legalName,o.address_json AS organizationAddress,o.branding_json AS organizationBranding,
    sp.school_code AS schoolCode,sp.registration_number AS schoolRegistrationNumber,sp.logo_url AS schoolLogoUrl,sp.motto AS schoolMotto,
    sp.phone_numbers_json AS schoolPhones,sp.email_addresses_json AS schoolEmails,sp.website AS schoolWebsite,
    sp.physical_address AS schoolPhysicalAddress,sp.postal_address AS schoolPostalAddress
  FROM school_fee_receipts r
  JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id
  JOIN contacts ct ON ct.id=r.payer_contact_id AND ct.organization_id=r.organization_id
  LEFT JOIN school_payment_methods pm ON pm.id=r.payment_method_id AND pm.organization_id=r.organization_id
  LEFT JOIN school_students s ON s.id=r.student_id AND s.organization_id=r.organization_id
  LEFT JOIN school_classes cl ON cl.id=s.current_class_id AND cl.organization_id=s.organization_id
  LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
  LEFT JOIN users u ON u.id=r.created_by
  JOIN organizations o ON o.id=r.organization_id
  LEFT JOIN school_profiles sp ON sp.organization_id=r.organization_id
  WHERE r.id=? AND r.organization_id=?`).bind(receiptId,org).first<AnyRow>();
  if(!row)throw new AppError(404,"FEE_RECEIPT_NOT_FOUND","School fee receipt not found");
  const allocations=await db.prepare(`SELECT pa.amount_minor AS amountMinor,d.number AS invoiceNumber,fc.name AS feeCategoryName,c.description
    FROM payment_allocations pa
    JOIN documents d ON d.id=pa.document_id AND d.organization_id=pa.organization_id
    LEFT JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id
    LEFT JOIN school_fee_categories fc ON fc.id=c.fee_category_id AND fc.organization_id=c.organization_id
    WHERE pa.payment_id=? AND pa.organization_id=?
    ORDER BY pa.created_at,pa.id`).bind(row.paymentId,org).all<AnyRow>();
  return {...row,allocations:allocations.results};
}

async function legacyHistoricalBalances(db:D1Database,org:string,source:AnyRow){
  if(!source.studentId)return{before:null,after:null};
  const totals=await db.prepare(`SELECT COALESCE(SUM(c.total_minor-c.credited_minor-c.written_off_minor),0) AS netBilled
    FROM school_student_fee_charges c
    JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
    WHERE c.organization_id=? AND c.student_id=?
      AND c.status IN ('invoiced','partially_settled','settled','credited','written_off')
      AND d.status IN ('open','partially_paid','paid','void')
      AND d.journal_entry_id IS NOT NULL
      AND (c.charge_date<? OR (c.charge_date=? AND c.created_at<=?))`).bind(org,source.studentId,source.paymentDate,source.paymentDate,source.createdAt).first<{netBilled:number}>();
  const paid=await db.prepare(`SELECT COALESCE(SUM(pa.amount_minor),0) AS paidMinor
    FROM payment_allocations pa
    JOIN payments p ON p.id=pa.payment_id AND p.organization_id=pa.organization_id
    JOIN documents d ON d.id=pa.document_id AND d.organization_id=pa.organization_id
    JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id
    WHERE pa.organization_id=? AND c.student_id=?
      AND (p.payment_date<? OR (p.payment_date=? AND p.created_at<=?))
      AND (pa.reversed_at IS NULL OR pa.reversed_at>?)`).bind(org,source.studentId,source.paymentDate,source.paymentDate,source.paymentCreatedAt,source.createdAt).first<{paidMinor:number}>();
  const thisAllocation=source.allocations.reduce((n:number,a:AnyRow)=>n+Number(a.amountMinor||0),0),after=Math.max(0,Number(totals?.netBilled||0)-Number(paid?.paidMinor||0));
  return{before:after+thisAllocation,after};
}

async function makeSnapshot(db:D1Database,org:string,receiptId:string,options:{balanceBeforeMinor?:number|null;finalize?:boolean}={}){
  const existing=await loadStoredArchive(db,org,receiptId);
  if(existing?.finalized)return existing;
  const source=await receiptSource(db,org,receiptId),finalize=Boolean(options.finalize||source.status!=="draft");
  let before=options.balanceBeforeMinor!==undefined?options.balanceBeforeMinor:existing?.balanceBeforeMinor??null,after=before;
  if(source.studentId){
    if(!existing&&source.status!=="draft"){
      const historical=await legacyHistoricalBalances(db,org,source);before=historical.before;after=historical.after;
    }else if(finalize){
      after=Number((await studentBalance(db,org,source.studentId)).balanceMinor||0);
      if(before==null)before=after+source.allocations.reduce((n:number,a:AnyRow)=>n+Number(a.amountMinor||0),0);
    }
  }
  const orgBranding=parseJson<AnyRow>(source.organizationBranding,{}),orgAddress=parseJson<AnyRow>(source.organizationAddress,{}),phones=parseJson<string[]>(source.schoolPhones,[]),emails=parseJson<string[]>(source.schoolEmails,[]);
  const amountWords=amountInWords(Number(source.amountMinor),String(source.currency));
  const snapshot={
    receipt:{id:source.id,receiptNumber:source.receiptNumber,paymentDate:source.paymentDate,currency:source.currency,amountMinor:Number(source.amountMinor),allocatedMinor:Number(source.allocatedMinor||0),unallocatedMinor:Number(source.unallocatedMinor||0),reference:source.reference||null,notes:source.notes||null,status:source.status},
    school:{name:source.legalName||source.organizationName,organizationName:source.organizationName,schoolCode:source.schoolCode||null,registrationNumber:source.schoolRegistrationNumber||null,address:source.schoolPhysicalAddress||source.schoolPostalAddress||orgAddress.formatted||null,phones,emails,website:source.schoolWebsite||orgBranding.website||null,motto:source.schoolMotto||orgBranding.footer||null,logo:source.schoolLogoUrl||orgBranding.logoDataUrl||null},
    payer:{id:source.payerContactId,name:source.payerName},
    student:source.studentId?{id:source.studentId,name:[source.firstName,source.middleName,source.lastName].filter(Boolean).join(" "),admissionNumber:source.admissionNumber||null,studentNumber:source.studentNumber||null,className:source.className||null,streamName:source.streamName||null}:null,
    payment:{methodName:source.paymentMethodName||null,methodCode:source.paymentMethodCode||null,reference:source.reference||null,receivedBy:source.receivedBy||null},
    amountWords,balanceBeforeMinor:before,balanceAfterMinor:after,
    allocations:source.allocations.map((a:AnyRow)=>({invoiceNumber:a.invoiceNumber||null,feeCategoryName:a.feeCategoryName||null,description:a.description||null,amountMinor:Number(a.amountMinor||0)})),
  };
  const json=JSON.stringify(snapshot),hash=await sha256(json);
  await db.prepare(`INSERT INTO school_fee_receipt_snapshots (receipt_id,organization_id,snapshot_version,finalized,amount_words,balance_before_minor,balance_after_minor,snapshot_json,content_hash,captured_at,finalized_at)
    VALUES (?,?,1,?,?,?,?,?,?,CURRENT_TIMESTAMP,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END)
    ON CONFLICT(organization_id,receipt_id) DO UPDATE SET snapshot_version=excluded.snapshot_version,finalized=excluded.finalized,amount_words=excluded.amount_words,balance_before_minor=excluded.balance_before_minor,balance_after_minor=excluded.balance_after_minor,snapshot_json=excluded.snapshot_json,content_hash=excluded.content_hash,captured_at=CURRENT_TIMESTAMP,finalized_at=CASE WHEN excluded.finalized=1 THEN CURRENT_TIMESTAMP ELSE school_fee_receipt_snapshots.finalized_at END
    WHERE school_fee_receipt_snapshots.finalized=0`).bind(receiptId,org,finalize?1:0,amountWords,before,after,json,hash,finalize?1:0).run();
  return (await loadStoredArchive(db,org,receiptId))!;
}

export async function captureDraftReceiptSnapshot(db:D1Database,org:string,receiptId:string,balanceBeforeMinor:number|null){return makeSnapshot(db,org,receiptId,{balanceBeforeMinor,finalize:false});}
export async function finalizeReceiptSnapshot(db:D1Database,org:string,receiptId:string){return makeSnapshot(db,org,receiptId,{finalize:true});}
export async function ensureReceiptSnapshot(db:D1Database,org:string,receiptId:string){const existing=await loadStoredArchive(db,org,receiptId);return existing||makeSnapshot(db,org,receiptId,{finalize:false});}
export async function receiptPrintHistory(db:D1Database,org:string,receiptId:string){const rows=await db.prepare(`SELECT pr.id,pr.purpose,pr.copy_no AS copyNo,pr.snapshot_hash AS snapshotHash,pr.rendered_at AS renderedAt,pr.created_at AS createdAt,u.display_name AS requestedBy FROM school_fee_receipt_prints pr LEFT JOIN users u ON u.id=pr.requested_by WHERE pr.organization_id=? AND pr.receipt_id=? ORDER BY pr.created_at DESC`).bind(org,receiptId).all<Record<string,unknown>>();return camelizeRows(rows.results);}

async function embedLogo(pdf:PDFDocument,value:unknown){
  const logo=String(value||"");if(!logo)return null;
  try{
    let bytes:Uint8Array|undefined,type="";
    const match=logo.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if(match){type=match[1]!.toLowerCase();bytes=Uint8Array.from(atob(match[2]!),c=>c.charCodeAt(0));}
    else if(/^https?:\/\//i.test(logo)){const response=await fetch(logo);if(response.ok){type=(response.headers.get("content-type")||"").toLowerCase();bytes=new Uint8Array(await response.arrayBuffer());}}
    if(!bytes)return null;
    return type.includes("png")?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
  }catch{return null;}
}
function pdfMoney(minor:unknown,currency:string){const amount=Number(minor||0)/100,code=String(currency||"UGX").toUpperCase();return `${code} ${amount.toLocaleString("en-US",{minimumFractionDigits:code==="UGX"?0:2,maximumFractionDigits:code==="UGX"?0:2})}`;}
function trim(value:unknown,max=70){const raw=String(value??"").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();return raw.length>max?`${raw.slice(0,max-3)}...`:raw;}

async function renderReceiptPdf(archive:ReceiptArchive,copyLabel:string,currentStatus:string){
  const s=archive.snapshot,pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.addPage([420,595]),dark=rgb(.08,.16,.14),accent=rgb(.04,.34,.25),muted=rgb(.42,.47,.45),line=rgb(.83,.87,.85),danger=rgb(.72,.08,.08),W=420,M=28;
  const logo=await embedLogo(pdf,s.school?.logo);let y=555;
  if(logo)page.drawImage(logo,{x:M,y:y-38,width:54,height:38});
  const hx=logo?92:M;page.drawText(trim(s.school?.name||"School",48),{x:hx,y,font:bold,size:14,color:dark});y-=15;
  const contact=[s.school?.address,(s.school?.phones||[]).join(", "),(s.school?.emails||[]).join(", ")].filter(Boolean).join(" · ");if(contact)page.drawText(trim(contact,90),{x:hx,y,font,size:6.5,color:muted});
  y-=25;page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:1.5,color:accent});y-=25;
  page.drawText("OFFICIAL SCHOOL FEES RECEIPT",{x:M,y,font:bold,size:15,color:accent});page.drawText(copyLabel,{x:W-M-bold.widthOfTextAtSize(copyLabel,8),y:y+3,font:bold,size:8,color:currentStatus==="reversed"?danger:muted});
  y-=30;const info=[["Receipt no.",s.receipt.receiptNumber],["Payment date",s.receipt.paymentDate],["Status",String(currentStatus||s.receipt.status).toUpperCase()],["Method",s.payment?.methodName||"—"]];
  info.forEach(([label,value],i)=>{const x=M+(i%2)*182,yy=y-Math.floor(i/2)*31;page.drawText(label,{x,y:yy,font,size:6.5,color:muted});page.drawText(trim(value,31),{x,y:yy-12,font:bold,size:9,color:label==="Status"&&currentStatus==="reversed"?danger:dark});});y-=72;
  page.drawRectangle({x:M,y:y-48,width:W-M*2,height:58,color:rgb(.96,.98,.97),borderColor:line,borderWidth:.6});page.drawText("RECEIVED FROM",{x:M+10,y:y-2,font:bold,size:6.5,color:muted});page.drawText(trim(s.payer?.name||"—",50),{x:M+10,y:y-18,font:bold,size:11,color:dark});
  if(s.student){const studentLine=[s.student.name,s.student.admissionNumber&&`Adm: ${s.student.admissionNumber}`,s.student.className,s.student.streamName].filter(Boolean).join(" · ");page.drawText(trim(studentLine,72),{x:M+10,y:y-34,font,size:7,color:muted});}y-=72;
  page.drawText("AMOUNT RECEIVED",{x:M,y,font:bold,size:6.5,color:muted});page.drawText(pdfMoney(s.receipt.amountMinor,s.receipt.currency),{x:M,y:y-25,font:bold,size:22,color:accent});y-=45;
  page.drawText("AMOUNT IN WORDS",{x:M,y,font:bold,size:6.5,color:muted});const words=trim(archive.amountWords,105);page.drawText(words,{x:M,y:y-15,font:bold,size:8,color:dark});y-=37;
  const before=archive.balanceBeforeMinor,after=archive.balanceAfterMinor;page.drawRectangle({x:M,y:y-47,width:W-M*2,height:56,borderColor:line,borderWidth:.8});const thirds=(W-M*2)/3;
  [["Balance before",before],["Amount paid",s.receipt.amountMinor],["Balance after",after]].forEach(([label,value],i)=>{const x=M+i*thirds+8;page.drawText(String(label),{x,y:y-4,font,size:6.5,color:muted});page.drawText(value==null?"—":pdfMoney(value,s.receipt.currency),{x,y:y-20,font:bold,size:9,color:i===2?accent:dark});if(i<2)page.drawLine({start:{x:M+(i+1)*thirds,y:y+5},end:{x:M+(i+1)*thirds,y:y-45},thickness:.5,color:line});});y-=68;
  if(s.allocations?.length){page.drawText("APPLIED TO",{x:M,y,font:bold,size:6.5,color:muted});y-=14;for(const a of s.allocations.slice(0,5)){page.drawText(trim([a.invoiceNumber,a.feeCategoryName].filter(Boolean).join(" · "),52),{x:M,y,font,size:7,color:dark});const val=pdfMoney(a.amountMinor,s.receipt.currency);page.drawText(val,{x:W-M-font.widthOfTextAtSize(val,7),y,font:bold,size:7,color:dark});y-=13;}y-=4;}
  const ref=s.receipt.reference?`Reference: ${s.receipt.reference}`:"Reference: —";page.drawText(trim(ref,70),{x:M,y,font,size:7,color:muted});y-=13;page.drawText(`Received by: ${trim(s.payment?.receivedBy||"System",42)}`,{x:M,y,font,size:7,color:muted});
  if(currentStatus==="reversed"){page.drawRectangle({x:M,y:52,width:W-M*2,height:26,color:rgb(1,.93,.93),borderColor:danger,borderWidth:.7});page.drawText("REVERSED RECEIPT — retained for audit history",{x:M+10,y:61,font:bold,size:8,color:danger});}
  const verify=`Archive ${archive.contentHash.slice(0,16).toUpperCase()} · ${copyLabel}`;page.drawLine({start:{x:M,y:38},end:{x:W-M,y:38},thickness:.5,color:line});page.drawText(trim(s.school?.motto||"Thank you.",65),{x:M,y:25,font,size:6.5,color:muted});page.drawText(verify,{x:W-M-font.widthOfTextAtSize(verify,5.5),y:12,font,size:5.5,color:muted});
  return pdf.save();
}

export const schoolFeeReceiptPrintRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
schoolFeeReceiptPrintRoutes.use("*",requireScope("school:read"));

schoolFeeReceiptPrintRoutes.get("/receipts/:id/archive",schoolPermission("school.fees:read"),async c=>{const p=c.get("principal"),id=c.req.param("id"),archive=await ensureReceiptSnapshot(c.env.FINANCE_DB,p.organizationId,id),prints=await receiptPrintHistory(c.env.FINANCE_DB,p.organizationId,id);return c.json({data:{...archive,prints}})});

schoolFeeReceiptPrintRoutes.post("/receipts/:id/prints",schoolPermission("school.fees:read"),async c=>{
  const p=c.get("principal"),id=c.req.param("id"),parsed=z.object({purpose:z.enum(["print","download"]).default("print")}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid receipt print request",parsed.error.flatten());
  const receipt=await c.env.FINANCE_DB.prepare("SELECT status FROM school_fee_receipts WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<{status:string}>();
  if(!receipt)throw new AppError(404,"FEE_RECEIPT_NOT_FOUND","School fee receipt not found");if(receipt.status==="draft")throw new AppError(409,"RECEIPT_NOT_POSTED","Post the receipt before printing it");
  const archive=await ensureReceiptSnapshot(c.env.FINANCE_DB,p.organizationId,id),purpose=parsed.data.purpose;
  let copyNo=0;const printId=createId("rpt"),userAgent=(c.req.header("User-Agent")||"").slice(0,500),ip=(c.req.header("CF-Connecting-IP")||c.req.header("X-Forwarded-For")||"").split(",")[0]!.trim().slice(0,100);
  if(purpose==="print"){const inserted=await c.env.FINANCE_DB.prepare(`INSERT INTO school_fee_receipt_prints (id,organization_id,receipt_id,purpose,copy_no,snapshot_hash,requested_by,user_agent,ip_address) SELECT ?,?,?,'print',COALESCE(MAX(copy_no),0)+1,?,?,?,? FROM school_fee_receipt_prints WHERE organization_id=? AND receipt_id=? AND purpose='print' RETURNING copy_no AS copyNo`).bind(printId,p.organizationId,id,archive.contentHash,p.userId,userAgent||null,ip||null,p.organizationId,id).first<{copyNo:number}>();copyNo=Number(inserted?.copyNo||1);}
  else await c.env.FINANCE_DB.prepare(`INSERT INTO school_fee_receipt_prints (id,organization_id,receipt_id,purpose,copy_no,snapshot_hash,requested_by,user_agent,ip_address) VALUES (?,?,?,'download',0,?,?,?,?)`).bind(printId,p.organizationId,id,archive.contentHash,p.userId,userAgent||null,ip||null).run();
  return c.json({data:{id:printId,receiptId:id,purpose,copyNo,copyLabel:purpose==="print"?(copyNo===1?"ORIGINAL":`REPRINT #${copyNo}`):"ARCHIVE COPY",snapshotHash:archive.contentHash,pdfPath:`/school/fees/receipts/${id}/pdf?printId=${encodeURIComponent(printId)}`}},201);
});

schoolFeeReceiptPrintRoutes.get("/receipts/:id/pdf",schoolPermission("school.fees:read"),async c=>{
  const p=c.get("principal"),id=c.req.param("id"),printId=c.req.query("printId"),receipt=await c.env.FINANCE_DB.prepare("SELECT receipt_number AS receiptNumber,status FROM school_fee_receipts WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<{receiptNumber:string;status:string}>();
  if(!receipt)throw new AppError(404,"FEE_RECEIPT_NOT_FOUND","School fee receipt not found");if(receipt.status==="draft")throw new AppError(409,"RECEIPT_NOT_POSTED","Post the receipt before printing it");
  const archive=await ensureReceiptSnapshot(c.env.FINANCE_DB,p.organizationId,id);let copyLabel="ARCHIVE COPY";
  if(printId){const pr=await c.env.FINANCE_DB.prepare("SELECT purpose,copy_no AS copyNo,snapshot_hash AS snapshotHash FROM school_fee_receipt_prints WHERE id=? AND organization_id=? AND receipt_id=?").bind(printId,p.organizationId,id).first<{purpose:string;copyNo:number;snapshotHash:string}>();if(!pr)throw new AppError(404,"PRINT_REQUEST_NOT_FOUND","Receipt print request not found");if(pr.snapshotHash!==archive.contentHash)throw new AppError(409,"RECEIPT_ARCHIVE_CHANGED","The archived receipt changed after this print request; create a new print request");copyLabel=pr.purpose==="print"?(pr.copyNo===1?"ORIGINAL":`REPRINT #${pr.copyNo}`):"ARCHIVE COPY";}
  const bytes=await renderReceiptPdf(archive,copyLabel,receipt.status);
  if(printId)await c.env.FINANCE_DB.prepare("UPDATE school_fee_receipt_prints SET rendered_at=COALESCE(rendered_at,CURRENT_TIMESTAMP) WHERE id=? AND organization_id=? AND receipt_id=?").bind(printId,p.organizationId,id).run();
  const filename=`${receipt.receiptNumber.replace(/[^A-Za-z0-9._-]+/g,"-")}.pdf`;return c.body(bytes.buffer as ArrayBuffer,200,{"Content-Type":"application/pdf","Content-Disposition":`inline; filename=\"${filename}\"`,"Cache-Control":"private, no-store","X-Receipt-Archive-Hash":archive.contentHash});
});
