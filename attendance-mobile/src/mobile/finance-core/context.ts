import {MobileApiError} from "../auth";
import type{Account,BankAccount,Dimension,FinanceProject,Product,TaxCode}from"./types";
export function err(e:unknown){return e instanceof MobileApiError?e.message:e instanceof Error?e.message:"Something went wrong."}
const pad=(n:number)=>String(n).padStart(2,"0");
export function today(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
export function month(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}`}
export function minor(value:string|number){const n=typeof value==="number"?value:Number(String(value).replace(/,/g,""));return Number.isFinite(n)?Math.round(n*100):0}
export function major(value:number|undefined|null){return (Number(value||0)/100).toFixed(2)}
export function qtyMicros(value:string|number){const n=typeof value==="number"?value:Number(String(value).replace(/,/g,""));return Number.isFinite(n)?Math.round(n*1_000_000):0}
export function qty(value:number|undefined|null){return Number(value||0)/1_000_000}
export function money(value:number|undefined|null,currency="UGX"){return `${currency} ${(Number(value||0)/100).toLocaleString("en-UG",{minimumFractionDigits:0,maximumFractionDigits:2})}`}
export function tone(status:string){const v=String(status||"").toLowerCase();if(["active","approved","posted","paid","completed","filed","open","matched","delivered"].includes(v))return "good" as const;if(["draft","submitted","scheduled","soft_closed","partially_paid","unmatched","locked","queued"].includes(v))return "warn" as const;if(["reversed","cancelled","archived","failed","inactive","void"].includes(v))return "bad" as const;return "neutral" as const}
export const idempotency=(prefix="mobile")=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
export const accountOptions=(rows:Account[],filter?:(x:Account)=>boolean)=>(filter?rows.filter(filter):rows).map(x=>({label:`${x.code} · ${x.name}`,value:x.id,detail:[x.type,x.subtype,x.active?null:"inactive",x.allowPosting?null:"no posting"].filter(Boolean).join(" · ")}));
export const postingAccounts=(rows:Account[])=>accountOptions(rows,x=>x.active&&x.allowPosting);
export const contactOptions=(rows:any[])=>rows.map(x=>({label:String(x.name||x.code||x.id),value:String(x.id),detail:[x.type,x.code,x.email].filter(Boolean).join(" · ")}));
export const productOptions=(rows:Product[])=>rows.filter(x=>x.active).map(x=>({label:`${x.sku} · ${x.name}`,value:x.id,detail:x.type}));
export const projectOptions=(rows:FinanceProject[])=>rows.map(x=>({label:`${x.code} · ${x.name}`,value:x.id,detail:x.customer||x.status}));
export const dimensionOptions=(rows:Dimension[],type:Dimension["type"])=>rows.filter(x=>x.type===type&&x.active).map(x=>({label:`${x.code} · ${x.name}`,value:x.id}));
export const taxOptions=(rows:TaxCode[])=>rows.filter(x=>x.active).map(x=>({label:`${x.code} · ${x.name}`,value:x.id,detail:`${(x.rateMicros/10000).toFixed(2)}% · ${x.taxType}`}));
export const bankOptions=(rows:BankAccount[])=>rows.filter(x=>x.active).map(x=>({label:x.name,value:x.id,detail:[x.bankName,x.currency,x.accountNumberMasked].filter(Boolean).join(" · ")}));
export const boolOptions=[{label:"Active",value:"true"},{label:"Inactive",value:"false"}];
