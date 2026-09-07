import { ApiError, authStore, post } from "./api";

type PrintRequest={id:string;receiptId:string;purpose:"print"|"download";copyNo:number;copyLabel:string;snapshotHash:string;pdfPath:string};

async function fetchReceiptPdf(path:string){
  const response=await fetch(`/api/v1${path}`,{headers:{Accept:"application/pdf",Authorization:`Bearer ${authStore.getAccess()||""}`}});
  if(!response.ok){const payload=await response.clone().json().catch(()=>({})) as {error?:{code?:string;message?:string;details?:unknown}};throw new ApiError(response.status,payload.error?.code||"RECEIPT_PDF_FAILED",payload.error?.message||`Receipt PDF could not be generated (${response.status})`,payload.error?.details);}
  return response.blob();
}

export async function openReceiptPdf(receiptId:string,receiptNumber:string,purpose:"print"|"download"="print"){
  const popup=purpose==="print"?window.open("","_blank","noopener,noreferrer"):null;
  if(popup){popup.document.write("<p style='font-family:Arial,sans-serif;padding:24px'>Preparing archived receipt PDF…</p>");}
  try{
    const request=await post<PrintRequest>(`/school/fees/receipts/${receiptId}/prints`,{purpose}),blob=await fetchReceiptPdf(request.pdfPath),url=URL.createObjectURL(blob);
    if(purpose==="download"){
      const a=document.createElement("a");a.href=url;a.download=`${receiptNumber||"receipt"}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    }else if(popup){popup.location.href=url;setTimeout(()=>URL.revokeObjectURL(url),120_000);}
    else{const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener noreferrer";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120_000);}
    return request;
  }catch(error){popup?.close();throw error;}
}
