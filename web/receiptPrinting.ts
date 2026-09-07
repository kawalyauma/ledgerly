import { ApiError, authStore, post } from "./api";
import { reservePrintWindow } from "./printing";

type PrintRequest={id:string;receiptId:string;purpose:"print"|"download";copyNo:number;copyLabel:string;snapshotHash:string;pdfPath:string};

async function fetchReceiptPdf(path:string){
  const response=await fetch(`/api/v1${path}`,{headers:{Accept:"application/pdf",Authorization:`Bearer ${authStore.getAccess()||""}`}});
  if(!response.ok){const payload=await response.clone().json().catch(()=>({})) as {error?:{code?:string;message?:string;details?:unknown}};throw new ApiError(response.status,payload.error?.code||"RECEIPT_PDF_FAILED",payload.error?.message||`Receipt PDF could not be generated (${response.status})`,payload.error?.details);}
  return response.blob();
}

export async function openReceiptPdf(receiptId:string,receiptNumber:string,purpose:"print"|"download"="print"){
  // Reserve a real tab during the click. Using noopener in window.open features can
  // return null in some browsers; setting opener to null after opening is safer.
  const popup=purpose==="print"?reservePrintWindow("Preparing archived receipt PDF…"):null;
  try{
    const request=await post<PrintRequest>(`/school/fees/receipts/${receiptId}/prints`,{purpose}),blob=await fetchReceiptPdf(request.pdfPath),url=URL.createObjectURL(blob);
    if(purpose==="download"){
      const a=document.createElement("a");a.href=url;a.download=`${receiptNumber||"receipt"}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    }else if(popup){
      popup.location.replace(url);
      setTimeout(()=>URL.revokeObjectURL(url),120_000);
    }else{
      // Fallback for environments that block tabs. A temporary visible link works
      // on touch browsers and still allows the user to open/print the PDF.
      const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="Open receipt PDF";
      a.style.position="fixed";a.style.right="16px";a.style.bottom="16px";a.style.zIndex="99999";a.style.padding="12px 16px";a.style.background="#17201d";a.style.color="#fff";a.style.borderRadius="8px";
      document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(url)},120_000);
    }
    return request;
  }catch(error){popup?.close();throw error;}
}
