import {createHash} from "node:crypto";

export function sha256(buffer){return createHash("sha256").update(buffer).digest("hex")}
export function parseLpRequestId(output=""){return String(output).match(/request id is\s+(\S+)/i)?.[1]||null}
export function extensionForMime(mime="application/pdf"){return ({"application/pdf":".pdf","image/png":".png","image/jpeg":".jpg","text/plain":".txt","text/html":".html"})[mime]||".print"}
export function buildLpArgs(job,file){const args=[];const systemName=job.printer_system_name||job.printerSystemName;if(systemName)args.push("-d",String(systemName));args.push("-n",String(Math.max(1,Number(job.copies)||1)));if(job.page_size)args.push("-o",`media=${job.page_size}`);args.push("-o",job.duplex?"sides=two-sided-long-edge":"sides=one-sided");if(job.color_mode==="monochrome")args.push("-o","ColorModel=Gray");if(job.page_range)args.push("-P",String(job.page_range));args.push(file);return args}

export function parseSaneDevices(output=""){
  const devices=[];
  for(const line of String(output).split(/\r?\n/)){
    const m=line.match(/^device [`']([^`']+)[`'] is (.+)$/i);if(!m)continue;
    devices.push({systemName:m[1],name:m[2].trim(),status:"ready",capabilities:{sane:true}});
  }
  return devices;
}

const MM={A4:[210,297],A5:[148,210],Letter:[216,279],Legal:[216,356]};
export function scanArea(pageSize="A4"){const [width,height]=MM[pageSize]||MM.A4;return {width,height}}
export function buildScanArgs(job,{batchPattern=null}={}){
  const args=["--device-name",String(job.scanner_system_name||job.scannerSystemName),"--resolution",String(Math.max(75,Math.min(1200,Number(job.resolution_dpi||job.resolutionDpi)||300)))];
  const mode=job.color_mode||job.colorMode||"color";args.push("--mode",mode==="gray"?"Gray":mode==="lineart"?"Lineart":"Color");
  const source=job.source==="adf"?"ADF":"Flatbed";args.push("--source",source);
  const {width,height}=scanArea(job.page_size||job.pageSize);args.push("-x",String(width),"-y",String(height));
  if(batchPattern)args.push(`--batch=${batchPattern}`,"--format=png");
  else args.push("--format=png");
  return args;
}

export function parsePrinterHealth(text=""){
  const raw=String(text),reasons=[];
  const patterns=[
    [/disabled|paused|stopped/i,"stopped"],[/media[- ]empty|out of paper|paper[- ]out/i,"media-empty"],[/media[- ]low|paper[- ]low/i,"media-low"],
    [/toner[- ]empty|toner empty/i,"toner-empty"],[/toner[- ]low|low toner/i,"toner-low"],[/jam/i,"media-jam"],[/door.*open/i,"door-open"],[/cover.*open/i,"cover-open"],
    [/offline|not connected|unplugged/i,"offline"],[/warming/i,"warming-up"]
  ];
  for(const [pattern,reason] of patterns)if(pattern.test(raw)&&!reasons.includes(reason))reasons.push(reason);
  return reasons;
}

export function parseMarkerLevels(text=""){
  const rows=[];for(const line of String(text).split(/\r?\n/)){const m=line.match(/(?:marker|toner|ink)[^:]*:\s*([^,]+),?\s*(\d{1,3})%/i);if(m)rows.push({name:m[1].trim(),levelPercent:Math.max(0,Math.min(100,Number(m[2])))})}return rows;
}

export function parseCupsCompletedSheets(text="",fallback=0){
  const raw=String(text);const pages=[...raw.matchAll(/(?:pages?|impressions?)\s*[:=]?\s*(\d+)/gi)].map(x=>Number(x[1]));return pages.length?Math.max(...pages):Math.max(0,Number(fallback)||0)
}
