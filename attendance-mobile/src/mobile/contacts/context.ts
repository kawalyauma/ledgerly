import {MobileApiError} from "../auth";
import type {CoreContact,DirectoryPerson} from "./types";
export function err(e:unknown){return e instanceof MobileApiError?e.message:e instanceof Error?e.message:"Something went wrong."}
export function money(minor?:number|null,currency="UGX"){return `${currency} ${(Number(minor||0)/100).toLocaleString(undefined,{maximumFractionDigits:0})}`}
export function tone(status:string){const v=String(status).toLowerCase();return (["active","available","sms","whatsapp"] as string[]).includes(v)?"good" as const:(["archived","inactive","disabled"] as string[]).includes(v)?"bad" as const:"neutral" as const}
export const contactTypes=["customer","supplier","employee","other"].map(x=>({label:x[0].toUpperCase()+x.slice(1),value:x}));
export function contactOptions(rows:CoreContact[],exclude?:string){return rows.filter(x=>x.id!==exclude).map(x=>({label:x.name,value:x.id,detail:[x.code,x.type,x.email].filter(Boolean).join(" · ")}))}
export function personSubtitle(p:DirectoryPerson){return [p.code,p.group,p.sourceModule,p.phone,p.email].filter(Boolean).join(" · ")}
