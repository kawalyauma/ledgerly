import { authStore, get } from "./api";

type ReportOrganization={name?:string;legalName?:string;address?:Record<string,unknown>;taxRegistrationNumber?:string;branding?:{logoDataUrl?:string;email?:string;phone?:string;website?:string;footer?:string}};
type SchoolProfile={schoolName?:string;legalName?:string;registrationNumber?:string;logoUrl?:string;motto?:string;phoneNumbers?:string[];emailAddresses?:string[];website?:string;physicalAddress?:string;postalAddress?:string};
type StudentProfile={id?:string;firstName?:string;middleName?:string;lastName?:string;admissionNumber?:string;studentNumber?:string;profilePhotoUrl?:string|null;profilePhotoFileId?:string|null};
let identityPromise:Promise<ReportOrganization>|null=null;

async function identity(){
  if(!identityPromise)identityPromise=(async()=>{const [org,school]=await Promise.all([get<ReportOrganization>("/organizations/current").catch(()=>({} as ReportOrganization)),get<SchoolProfile|null>("/school/setup/profile").catch(()=>null)]);if(!school)return org;return{...org,name:school.schoolName||org.name||school.legalName||"School",legalName:school.legalName||school.schoolName||org.legalName||org.name,address:{...(org.address||{}),formatted:school.physicalAddress||school.postalAddress||org.address?.formatted||""},taxRegistrationNumber:school.registrationNumber||org.taxRegistrationNumber,branding:{...(org.branding||{}),logoDataUrl:school.logoUrl||org.branding?.logoDataUrl,phone:school.phoneNumbers?.filter(Boolean).join(", ")||org.branding?.phone,email:school.emailAddresses?.filter(Boolean).join(", ")||org.branding?.email,website:school.website||org.branding?.website,footer:school.motto||org.branding?.footer}};})();
  return identityPromise;
}
function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]||ch));}
function selectedStatementStudentId(){const node=document.querySelector<HTMLElement>('.fees-report-filters .searchable-select[data-aria-label="Student"][data-value]');return node?.dataset.value||"";}
function blobDataUrl(blob:Blob){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
async function statementStudentPhoto(){
  const id=selectedStatementStudentId();if(!id)return null;
  try{
    const student=await get<StudentProfile>(`/school/student-management/students/${encodeURIComponent(id)}`);
    let src=String(student.profilePhotoUrl||"");
    if(student.profilePhotoFileId){
      const token=authStore.getAccess(),response=await fetch(`/api/v1/school/files/${encodeURIComponent(student.profilePhotoFileId)}/content`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(response.ok&&String(response.headers.get("content-type")||"").startsWith("image/"))src=await blobDataUrl(await response.blob());
    }
    if(!src)return null;
    return{src,name:[student.firstName,student.middleName,student.lastName].filter(Boolean).join(" "),number:student.admissionNumber||student.studentNumber||""};
  }catch{return null;}
}

/** School-fee reports use the same visual language as the archived official fee receipt. */
export function printFeeReportElement(elementId:string,title:string,subtitle=""){
  const root=document.getElementById(elementId);if(!root)return;
  const popup=window.open("","_blank","noopener,noreferrer,width=1100,height=800");if(!popup)return;
  popup.document.write("<p style='font-family:Arial,sans-serif;padding:24px'>Preparing official school fees report…</p>");
  const photoRequest=title.toLowerCase()==="school fee statement"?statementStudentPhoto():Promise.resolve(null);
  void Promise.all([identity(),photoRequest]).then(([org,studentPhoto])=>{const b=org.branding||{},address=String(org.address?.formatted||""),contact=[b.phone,b.email,b.website].filter(Boolean).join(" · "),logo=b.logoDataUrl?`<img src="${esc(b.logoDataUrl)}" alt="School logo">`:"",studentIdentity=studentPhoto?`<div class="student-identity"><img class="student-photo" src="${esc(studentPhoto.src)}" alt="${esc(studentPhoto.name||"Student")}"><div><small>STUDENT</small><b>${esc(studentPhoto.name||subtitle)}</b>${studentPhoto.number?`<span>${esc(studentPhoto.number)}</span>`:""}</div></div>`:"";
    popup.document.open();popup.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
      @page{size:auto;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#142924;margin:0;font-size:11px}.receipt-head{display:flex;align-items:center;gap:16px}.receipt-head img{width:62px;height:48px;object-fit:contain}.receipt-head h1{font-size:17px;margin:0 0 3px;color:#142924}.receipt-head p{font-size:8.5px;margin:2px 0;color:#6b7873}.accent{height:2px;background:#0a5740;margin:13px 0 15px}.title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:12px}.title-row h2{margin:0;color:#0a5740;font-size:16px;text-transform:uppercase;letter-spacing:.25px}.title-row p{margin:4px 0 0;color:#6b7873}.meta{text-align:right;font-size:8px;color:#6b7873;white-space:nowrap}.student-identity{display:flex;align-items:center;gap:11px;border:1px solid #d4ded9;background:#f7faf9;padding:8px 10px;margin:0 0 12px}.student-photo{width:54px;height:62px;object-fit:cover;border:1px solid #d4ded9}.student-identity small,.student-identity span{display:block;color:#6b7873;font-size:7px}.student-identity b{display:block;font-size:12px;margin:3px 0}.report-box{border:1px solid #d4ded9;padding:10px}.report-box table,table{width:100%;border-collapse:collapse}th,td{border:1px solid #d4ded9;padding:6px 7px;text-align:left;vertical-align:top}th{background:#f2f7f5;color:#19352d;font-weight:700}td small{display:block;color:#6b7873;margin-top:2px}.footer{display:flex;justify-content:space-between;gap:18px;border-top:1px solid #d4ded9;margin-top:18px;padding-top:8px;color:#6b7873;font-size:8px}.footer .official{font-weight:700;color:#0a5740}.badge{border:0!important;background:none!important;color:inherit!important;padding:0!important}.badge__dot,button,.button,.report-tools,.report-pagination{display:none!important}tr{break-inside:avoid}.report-export-source{display:block!important;position:static!important;visibility:visible!important}.report-export-source>table{display:table!important}tfoot{font-weight:700}
    </style></head><body><header class="receipt-head">${logo}<div><h1>${esc(org.legalName||org.name||"School")}</h1>${address?`<p>${esc(address)}</p>`:""}${contact?`<p>${esc(contact)}</p>`:""}${org.taxRegistrationNumber?`<p>Registration: ${esc(org.taxRegistrationNumber)}</p>`:""}</div></header><div class="accent"></div><section class="title-row"><div><h2>Official school fees report</h2><p><b>${esc(title)}</b>${subtitle?` · ${esc(subtitle)}`:""}</p></div><div class="meta">Generated<br><b>${esc(new Date().toLocaleString("en-UG"))}</b></div></section>${studentIdentity}<main class="report-box">${root.innerHTML}</main><footer class="footer"><span>${esc(b.footer||"Official school fees record")}</span><span class="official">Ledgerly School Fees</span></footer><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);popup.document.close();
  }).catch(()=>popup.close());
}
