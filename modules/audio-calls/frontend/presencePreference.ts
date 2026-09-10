export type CallAvailability="available"|"do_not_disturb";
const KEY="ledgerly.audio-calls.availability";
const EVENT="ledgerly:audio-call-availability";

export function getCallAvailability():CallAvailability{
  try{return localStorage.getItem(KEY)==="do_not_disturb"?"do_not_disturb":"available"}catch{return"available"}
}
export function setCallAvailability(value:CallAvailability){
  try{localStorage.setItem(KEY,value)}catch{}
  window.dispatchEvent(new CustomEvent(EVENT,{detail:value}));
}
export function subscribeCallAvailability(listener:(value:CallAvailability)=>void){
  const handler=(event:Event)=>listener((event as CustomEvent<CallAvailability>).detail||getCallAvailability());
  window.addEventListener(EVENT,handler);return()=>window.removeEventListener(EVENT,handler);
}
