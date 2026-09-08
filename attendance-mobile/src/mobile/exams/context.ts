import type {SetupBundle} from "../school/types";
export const localDate=()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return`${y}-${m}-${day}`};
export const truthy=(v:any)=>v===true||v===1||v==="1";
export const opts=(items:any[]=[],nameKey="name")=>items.map(x=>({label:String(x[nameKey]||x.name||x.code||x.id),value:String(x.id),detail:x.code||x.admission_number||x.student_number||undefined}));
export const years=(s:SetupBundle|null)=>s?.academicYears||[];
export const termsFor=(s:SetupBundle|null,yearId:string)=>(s?.terms||[]).filter((x:any)=>!yearId||x.academicYearId===yearId||x.academic_year_id===yearId);
export const classesFor=(s:SetupBundle|null,yearId:string)=>(s?.classes||[]).filter((x:any)=>!yearId||!x.academicYearId&&!x.academic_year_id||x.academicYearId===yearId||x.academic_year_id===yearId);
export const streamsFor=(s:SetupBundle|null,classId:string)=>(s?.streams||[]).filter((x:any)=>!classId||x.classId===classId||x.class_id===classId);
export function defaultPeriod(s:SetupBundle|null){const y=years(s).find((x:any)=>truthy(x.isCurrent??x.is_current))||years(s)[0],ts=termsFor(s,y?.id||""),t=ts.find((x:any)=>truthy(x.isCurrent??x.is_current))||ts[0];return{yearId:y?.id||"",termId:t?.id||""}}
export const studentName=(x:any)=>[x.first_name,x.middle_name,x.last_name].filter(Boolean).join(" ");
export const tone=(status?:string)=>status==="published"||status==="active"?"good":status==="archived"?"bad":"warn";
export const err=(e:any)=>e?.message||"Request failed. Check your connection and permissions.";
