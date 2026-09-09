import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import type {ArchivedContact,ContactAddress,ContactCapability,ContactDetail,ContactPerson,CoreContact,DirectoryPerson} from "./types";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,path,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
const yes=(v:any)=>v===true||v===1||v==="1";
const contact=(x:any):CoreContact=>({...x,id:String(x.id),paymentTermsDays:Number(x.paymentTermsDays||0),creditLimitMinor:Number(x.creditLimitMinor||0),active:yes(x.active),customFields:x.customFields&&typeof x.customFields==="object"?x.customFields:{}});
const address=(x:any):ContactAddress=>({...x,id:String(x.id),isDefault:yes(x.isDefault)});
const person=(x:any):ContactPerson=>({...x,id:String(x.id),isPrimary:yes(x.isPrimary)});
export const contactsApi={
  capabilities:(c:Client)=>req<ContactCapability>(c,"/contacts/capabilities"),
  people:(c:Client,params:{search?:string;source?:string;group?:string;channel?:string;limit?:number;offset?:number}={})=>req<DirectoryPerson[]>(c,`/contacts/people${query({...params,limit:params.limit||250})}`),
  contacts:async(c:Client,type?:string)=>(await req<any[]>(c,`/contacts${query({type,limit:500})}`)).map(contact),
  createContact:async(c:Client,body:any)=>contact(await req<any>(c,"/contacts",json("POST",body))),
  updateContact:async(c:Client,id:string,body:any)=>contact(await req<any>(c,`/contacts/${id}`,json("PUT",body))),
  deleteContact:(c:Client,id:string)=>req<void>(c,`/contacts/${id}`,{method:"DELETE"}),
  archiveContact:(c:Client,id:string)=>req<any>(c,`/contacts/${id}/archive`,json("POST",{})),
  mergeContact:(c:Client,id:string,targetContactId:string)=>req<any>(c,`/contacts/${id}/merge`,json("POST",{targetContactId})),
  detail:async(c:Client,id:string)=>{const d=await req<any>(c,`/contacts/${id}/detail`);return {contact:contact(d.contact),addresses:(d.addresses||[]).map(address),people:(d.people||[]).map(person)} as ContactDetail},
  archived:(c:Client)=>req<ArchivedContact[]>(c,"/contacts/archived"),
  restore:(c:Client,id:string)=>req<any>(c,`/contacts/${id}/restore`,json("POST",{})),
  createAddress:async(c:Client,id:string,body:any)=>address(await req<any>(c,`/contacts/${id}/addresses/manage`,json("POST",body))),
  updateAddress:async(c:Client,id:string,addressId:string,body:any)=>address(await req<any>(c,`/contacts/${id}/addresses/${addressId}`,json("PATCH",body))),
  deleteAddress:(c:Client,id:string,addressId:string)=>req<void>(c,`/contacts/${id}/addresses/${addressId}`,{method:"DELETE"}),
  createPerson:async(c:Client,id:string,body:any)=>person(await req<any>(c,`/contacts/${id}/people/manage`,json("POST",body))),
  updatePerson:async(c:Client,id:string,personId:string,body:any)=>person(await req<any>(c,`/contacts/${id}/people/${personId}`,json("PATCH",body))),
  deletePerson:(c:Client,id:string,personId:string)=>req<void>(c,`/contacts/${id}/people/${personId}`,{method:"DELETE"}),
};
