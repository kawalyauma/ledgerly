// @ts-nocheck

type ReversalPreview = {
  journal: { id:string; entryNumber?:string; description?:string; sourceType?:string|null; status:string };
  impacts: { type:string; id:string; label:string; status?:string; action:string }[];
  blockers: string[];
  mode: string;
};

function escapeText(value:any){return String(value??"")}

function askForReversal(preview:ReversalPreview, initialDate:string){
  return new Promise<{postingDate:string;reason:string}|null>(resolve=>{
    const overlay=document.createElement("div");
    overlay.setAttribute("role","dialog");
    overlay.setAttribute("aria-modal","true");
    overlay.style.cssText="position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Arial,Helvetica,sans-serif";
    const card=document.createElement("div");
    card.style.cssText="width:min(680px,100%);max-height:92vh;overflow:auto;background:#fff;color:#17201d;border-radius:14px;box-shadow:0 22px 70px rgba(0,0,0,.28);padding:22px";
    const title=document.createElement("h2");title.textContent="Reverse accounting transaction";title.style.cssText="margin:0 0 6px;font-size:21px";
    const intro=document.createElement("p");intro.textContent=`${preview.journal.entryNumber||"Journal"} · ${preview.journal.description||"Accounting entry"}`;intro.style.cssText="margin:0 0 16px;color:#64748b";
    card.append(title,intro);

    const affected=document.createElement("div");affected.style.cssText="border:1px solid #dbe3df;border-radius:10px;padding:14px;margin-bottom:14px";
    const ah=document.createElement("strong");ah.textContent="This reversal will affect:";affected.appendChild(ah);
    const ul=document.createElement("ul");ul.style.cssText="padding-left:20px;margin:10px 0 0";
    for(const item of preview.impacts||[]){
      const li=document.createElement("li");li.style.cssText="margin:8px 0";
      const b=document.createElement("b");b.textContent=item.label;
      const span=document.createElement("span");span.textContent=` — ${item.action}${item.status?` (currently ${item.status})`:""}`;span.style.color="#475569";
      li.append(b,span);ul.appendChild(li);
    }
    affected.appendChild(ul);card.appendChild(affected);

    if(preview.blockers?.length){
      const box=document.createElement("div");box.style.cssText="background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:10px;padding:13px;margin-bottom:14px";
      const strong=document.createElement("strong");strong.textContent="Reversal blocked";box.appendChild(strong);
      const bl=document.createElement("ul");bl.style.cssText="margin:8px 0 0;padding-left:20px";
      preview.blockers.forEach(x=>{const li=document.createElement("li");li.textContent=escapeText(x);bl.appendChild(li)});box.appendChild(bl);card.appendChild(box);
    }

    const form=document.createElement("form");
    const grid=document.createElement("div");grid.style.cssText="display:grid;grid-template-columns:minmax(160px,220px) 1fr;gap:12px;align-items:start";
    const dateLabel=document.createElement("label");dateLabel.textContent="Reversal posting date";dateLabel.style.cssText="display:grid;gap:6px;font-size:13px;font-weight:700";
    const date=document.createElement("input");date.type="date";date.required=true;date.value=initialDate||new Date().toISOString().slice(0,10);date.style.cssText="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit";dateLabel.appendChild(date);
    const reasonLabel=document.createElement("label");reasonLabel.textContent="Reason for reversal";reasonLabel.style.cssText="display:grid;gap:6px;font-size:13px;font-weight:700";
    const reason=document.createElement("textarea");reason.required=true;reason.minLength=3;reason.maxLength=500;reason.rows=4;reason.placeholder="Explain why this transaction is being reversed…";reason.style.cssText="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;resize:vertical";reasonLabel.appendChild(reason);
    grid.append(dateLabel,reasonLabel);form.appendChild(grid);

    const actions=document.createElement("div");actions.style.cssText="display:flex;justify-content:flex-end;gap:10px;margin-top:18px";
    const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Cancel";cancel.style.cssText="padding:10px 15px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer";
    const confirm=document.createElement("button");confirm.type="submit";confirm.textContent="Confirm reversal";confirm.disabled=Boolean(preview.blockers?.length);confirm.style.cssText=`padding:10px 15px;border-radius:8px;border:0;background:${confirm.disabled?"#94a3b8":"#9f1239"};color:#fff;font-weight:700;cursor:${confirm.disabled?"not-allowed":"pointer"}`;
    actions.append(cancel,confirm);form.appendChild(actions);card.appendChild(form);overlay.appendChild(card);document.body.appendChild(overlay);
    const finish=(value:any)=>{overlay.remove();resolve(value)};
    cancel.onclick=()=>finish(null);
    overlay.onmousedown=e=>{if(e.target===overlay)finish(null)};
    form.onsubmit=e=>{e.preventDefault();if(preview.blockers?.length)return;const r=reason.value.trim();if(r.length<3){reason.focus();return}finish({postingDate:date.value,reason:r})};
    setTimeout(()=>reason.focus(),0);
  });
}

export function installJournalReversalGuard(){
  if((window as any).__ledgerlyReversalGuardInstalled)return;
  (window as any).__ledgerlyReversalGuardInstalled=true;
  const nativeFetch=window.fetch.bind(window);

  window.fetch=async function(input:any,init:any={}){
    const url=typeof input==="string"?input:input instanceof URL?input.toString():String(input?.url||"");
    const method=String(init?.method||input?.method||"GET").toUpperCase();
    const match=url.match(/\/api\/v1\/journals\/([^/?]+)\/reverse(?:\?|$)/);
    if(!match||method!=="POST")return nativeFetch(input,init);

    const headers=new Headers(init?.headers||input?.headers||{});
    if(headers.get("X-Ledgerly-Reversal-Confirmed")==="1")return nativeFetch(input,init);

    const journalId=decodeURIComponent(match[1]);
    const previewHeaders=new Headers();
    const authorization=headers.get("Authorization");if(authorization)previewHeaders.set("Authorization",authorization);
    previewHeaders.set("Accept","application/json");
    const previewResponse=await nativeFetch(`/api/v1/journals/${encodeURIComponent(journalId)}/reversal-preview`,{headers:previewHeaders});
    if(!previewResponse.ok)return nativeFetch(input,init);
    const payload=await previewResponse.json().catch(()=>({}));
    const preview=(payload?.data||payload) as ReversalPreview;

    let original:any={};
    try{if(typeof init?.body==="string")original=JSON.parse(init.body)}catch{}
    const decision=await askForReversal(preview,String(original.postingDate||new Date().toISOString().slice(0,10)));
    if(!decision)throw new DOMException("Reversal cancelled","AbortError");

    headers.set("Content-Type","application/json");
    headers.set("X-Ledgerly-Reversal-Confirmed","1");
    return nativeFetch(input,{...init,headers,body:JSON.stringify({...original,...decision})});
  } as typeof window.fetch;
}
