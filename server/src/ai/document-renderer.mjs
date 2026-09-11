import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE={width:595.28,height:841.89,margin:54};

function parseJson(value,fallback={}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function text(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g,'"')
    .replace(/[‘’]/g,"'")
    .replace(/[–—]/g,"-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g,"?");
}

function label(key) {
  return text(String(key).replace(/[_-]+/g," ").replace(/\b\w/g,(c)=>c.toUpperCase()));
}

function contentLines(value,prefix="",depth=0) {
  if (depth>5) return [`${prefix}${text(JSON.stringify(value))}`];
  if (value == null) return prefix ? [`${prefix}-`] : [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [`${prefix}${text(value)}`];
  if (Array.isArray(value)) {
    const lines=[];
    for (const item of value) {
      if (item && typeof item === "object") {
        const nested=contentLines(item,"",depth+1);
        if (nested.length) { lines.push(`- ${nested[0]}`,...nested.slice(1).map((line)=>`  ${line}`)); }
      } else lines.push(`- ${text(item)}`);
    }
    return prefix && lines.length ? [`${prefix}${lines[0]}`,...lines.slice(1)] : lines;
  }
  const lines=[];
  for (const [key,item] of Object.entries(value)) {
    const head=`${label(key)}: `;
    if (item && typeof item === "object") {
      lines.push(label(key));
      lines.push(...contentLines(item,"",depth+1).map((line)=>`  ${line}`));
    } else lines.push(`${head}${text(item)}`);
  }
  return prefix && lines.length ? [`${prefix}${lines[0]}`,...lines.slice(1)] : lines;
}

function wrapLine(font,size,value,maxWidth) {
  const raw=text(value);
  if (!raw) return [""];
  const words=raw.split(/\s+/);
  const lines=[];let current="";
  for (const word of words) {
    const candidate=current?`${current} ${word}`:word;
    if (font.widthOfTextAtSize(candidate,size)<=maxWidth) { current=candidate; continue; }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word,size)<=maxWidth) { current=word; continue; }
    let part="";
    for (const character of word) {
      const next=part+character;
      if (font.widthOfTextAtSize(next,size)>maxWidth && part) { lines.push(part); part=character; }
      else part=next;
    }
    current=part;
  }
  if (current) lines.push(current);
  return lines;
}

async function organizationHeader(database,organizationId) {
  const organization=(await database.query(`SELECT id,name,legal_name,timezone,branding_json FROM organizations WHERE id=$1`,[organizationId])).rows[0];
  if (!organization) throw new Error("organization not found for document rendering");
  let school=null;
  try {
    school=(await database.query(`SELECT school_code,motto,physical_address,postal_address,country,district_region,location_text,head_teacher_name,branding_json FROM school_profiles WHERE organization_id=$1`,[organizationId])).rows[0]??null;
  } catch {
    school=null;
  }
  return {organization,school,branding:{...parseJson(organization.branding_json),...parseJson(school?.branding_json)}};
}

export function createAiDocumentRenderer({database,tenantStorage}) {
  if(!database?.query)throw new TypeError("AI document renderer requires database");
  if(!tenantStorage?.forOrganization)throw new TypeError("AI document renderer requires tenant-scoped storage");

  return async function renderAiDocument({document,context}) {
    if(!document?.document_id)throw new Error("structured document id is required");
    const organizationId=context?.organizationId??document.organization_id;
    if(!organizationId||organizationId!==document.organization_id)throw new Error("document is outside organization scope");
    const {organization,school}=await organizationHeader(database,organizationId);
    const pdf=await PDFDocument.create();
    const regular=await pdf.embedFont(StandardFonts.Helvetica);
    const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.setTitle(text(document.title));
    pdf.setAuthor(text(organization.name));
    pdf.setCreator("Ledgerly AI Workforce");
    pdf.setProducer("Ledgerly Self-Hosted");
    pdf.setCreationDate(new Date());

    let page;let y;
    const maxWidth=PAGE.width-PAGE.margin*2;
    const newPage=()=>{
      page=pdf.addPage([PAGE.width,PAGE.height]);
      y=PAGE.height-PAGE.margin;
      return page;
    };
    const ensure=(height)=>{if(y-height<PAGE.margin+24)newPage();};
    const draw=(value,{font=regular,size=10,leading=size*1.35,indent=0,spaceAfter=0}={})=>{
      const lines=wrapLine(font,size,value,maxWidth-indent);
      for(const line of lines){ensure(leading);page.drawText(line,{x:PAGE.margin+indent,y:y-size,font,size,color:rgb(0.08,0.08,0.08)});y-=leading;}
      y-=spaceAfter;
    };

    newPage();
    draw(organization.legal_name||organization.name,{font:bold,size:16,leading:20,spaceAfter:2});
    if(school?.motto)draw(school.motto,{size:9,leading:12,spaceAfter:2});
    const address=[school?.physical_address,school?.location_text,school?.district_region,school?.country].filter(Boolean).join(", ");
    if(address)draw(address,{size:9,leading:12,spaceAfter:8});else y-=8;
    page.drawLine({start:{x:PAGE.margin,y},end:{x:PAGE.width-PAGE.margin,y},thickness:0.8,color:rgb(0.55,0.55,0.55)});y-=18;
    draw(document.title,{font:bold,size:14,leading:18,spaceAfter:4});
    draw(`Document ID: ${document.document_id}    Version: ${document.version}    Status: ${String(document.status).toUpperCase()}`,{size:8,leading:11,spaceAfter:10});

    const lines=contentLines(document.content);
    for(const line of lines){
      const isHeading=!line.startsWith(" ")&&/^[A-Z][A-Za-z0-9 /&()-]{1,60}$/.test(line)&&!line.includes(":");
      draw(line,{font:isHeading?bold:regular,size:isHeading?11:10,leading:isHeading?15:13.5,indent:line.startsWith("  ")?12:0,spaceAfter:isHeading?2:0});
    }

    const creator=document.creator??{};
    y-=10;ensure(60);
    page.drawLine({start:{x:PAGE.margin,y},end:{x:PAGE.width-PAGE.margin,y},thickness:0.5,color:rgb(0.7,0.7,0.7)});y-=16;
    draw(`Prepared in Ledgerly${creator.agent_name?` by AI - ${text(creator.agent_name)}`:""}. AI-reviewed content is not official approval unless the document status is Approved or Published.`,{size:8,leading:11});

    const pages=pdf.getPages();
    pages.forEach((item,index)=>{
      const footer=`Ledgerly | ${text(organization.name)} | Page ${index+1} of ${pages.length}`;
      item.drawText(footer,{x:PAGE.margin,y:24,font:regular,size:7,color:rgb(0.35,0.35,0.35)});
    });

    const bytes=await pdf.save();
    const logicalRef=`ai/documents/${document.document_id}/v${document.version}.pdf`;
    const storage=tenantStorage.forOrganization(organizationId);
    await storage.put(logicalRef,Buffer.from(bytes),{contentType:"application/pdf",custom:{document_id:document.document_id,version:String(document.version),status:document.status}});
    return {ref:logicalRef,size:bytes.length,contentType:"application/pdf"};
  };
}
