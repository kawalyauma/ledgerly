import {createHash} from "node:crypto";

export function sha256(buffer){
  return createHash("sha256").update(buffer).digest("hex");
}

export function parseLpRequestId(output=""){
  const match=String(output).match(/request id is\s+(\S+)/i);
  return match?.[1]||null;
}

export function extensionForMime(mime="application/pdf"){
  return ({
    "application/pdf":".pdf",
    "image/png":".png",
    "image/jpeg":".jpg",
    "text/plain":".txt"
  })[mime]||".print";
}

export function buildLpArgs(job,file){
  const args=[];
  const systemName=job.printer_system_name||job.printerSystemName;
  if(systemName)args.push("-d",String(systemName));
  args.push("-n",String(Math.max(1,Number(job.copies)||1)));
  if(job.page_size)args.push("-o",`media=${job.page_size}`);
  args.push("-o",job.duplex?"sides=two-sided-long-edge":"sides=one-sided");
  if(job.color_mode==="monochrome")args.push("-o","ColorModel=Gray");
  args.push(file);
  return args;
}
