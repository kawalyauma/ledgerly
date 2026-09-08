import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const host=process.env.CAMERA_SERVER_HOST||"127.0.0.1";
const port=Number(process.env.CAMERA_SERVER_PORT||8789);
const storageRoot=path.resolve(process.env.CAMERA_STORAGE_ROOT||"./camera-storage");
fs.mkdirSync(storageRoot,{recursive:true});

function storage(){const stat=fs.statfsSync(storageRoot);return{root:storageRoot,totalBytes:Number(stat.blocks)*Number(stat.bsize),freeBytes:Number(stat.bavail)*Number(stat.bsize)}}
function send(res,status,body){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(body))}
const startedAt=new Date().toISOString();

const server=http.createServer((req,res)=>{
  const url=new URL(req.url||"/",`http://${req.headers.host||`${host}:${port}`}`);
  if(req.method==="GET"&&url.pathname==="/health")return send(res,200,{data:{service:"ledgerly-camera-server",version:"0.1.0",status:"ready",startedAt,storage:storage(),capabilities:["local-storage","health-api"]}});
  if(req.method==="GET"&&url.pathname==="/v1/storage")return send(res,200,{data:storage()});
  return send(res,404,{error:{code:"NOT_FOUND",message:"Camera server route not found"}});
});
server.listen(port,host,()=>console.log(`[ledgerly-camera-server] listening on http://${host}:${port}; storage=${storageRoot}`));
