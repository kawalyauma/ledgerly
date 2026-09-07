import { useState } from "react";
import { FileUp, LoaderCircle, Paperclip, X } from "lucide-react";
import { uploadFile } from "../api";

type Uploaded={id:string;originalName:string;mimeType:string;sizeBytes:number;contentUrl:string};
export function SchoolFileUpload({label="Upload file",purpose="document",accept,onChange,valueName,required=false,disabled=false}:{label?:string;purpose?:string;accept?:string;onChange:(file:Uploaded|null)=>void;valueName?:string;required?:boolean;disabled?:boolean}){
 const[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function choose(file?:File){if(!file)return;setBusy(true);setError("");try{onChange(await uploadFile<Uploaded>("/school/files",file,purpose))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="school-file-upload">
  <label className="school-file-button"><input type="file" accept={accept} disabled={busy||disabled} required={required&&!valueName} onChange={e=>void choose(e.target.files?.[0])}/>{busy?<LoaderCircle className="spin" size={16}/>:<FileUp size={16}/>}<span>{busy?"Uploading…":label}</span></label>
  {valueName&&<span className="school-file-value"><Paperclip size={13}/>{valueName}<button type="button" aria-label="Remove selected file" disabled={disabled} onClick={()=>onChange(null)}><X size={13}/></button></span>}
  {error&&<small className="field-error">{error}</small>}
 </div>
}
