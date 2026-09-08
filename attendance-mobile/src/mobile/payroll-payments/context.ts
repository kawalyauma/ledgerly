import type {Account,Counterparty,PayrollEmployee,PayrollRule} from "./types";
export const today=()=>{const d=new Date(),p=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`};
export const money=(minor?:number|null,currency="UGX")=>`${currency} ${(Number(minor||0)/100).toLocaleString(undefined,{maximumFractionDigits:0})}`;
export const err=(e:any)=>String(e?.message||e?.error?.message||"Something went wrong. Please retry.");
export const accountOptions=(rows:Account[],filter?:(a:Account)=>boolean)=>rows.filter(a=>a.active&&a.allowPosting&&(!filter||filter(a))).map(a=>({label:`${a.code} · ${a.name}`,value:a.id,detail:[a.type,a.subtype].filter(Boolean).join(" · ")}));
export const employeeOptions=(rows:PayrollEmployee[])=>rows.filter(x=>x.active).map(x=>({label:`${x.employeeNumber} · ${x.name}`,value:x.id,detail:`${x.payType} · ${money(x.basePayMinor,x.currency)}`}));
export const counterpartyOptions=(rows:Counterparty[],type:"receipt"|"payment")=>rows.filter(x=>type==="receipt"?x.type==="customer":["supplier","employee"].includes(x.type)).map(x=>({label:x.name,value:x.id,detail:[x.code,x.type,...(x.sourceModules||[])].filter(Boolean).join(" · ")}));
export const ruleOptions=(rows:PayrollRule[],payDate:string)=>rows.filter(x=>x.status==="active"&&x.effectiveFrom<=payDate&&(!x.effectiveTo||x.effectiveTo>=payDate)).map(x=>({label:x.name,value:x.id,detail:`${x.countryCode} · ${x.currency} · from ${x.effectiveFrom}`}));
export const tone=(status:string):"neutral"|"good"|"warn"|"bad"=>["posted","paid","processed","approved","active"].includes(status)?"good":["draft","pending","partially_paid","unpaid"].includes(status)?"warn":["reversed","rejected","archived"].includes(status)?"bad":"neutral";
