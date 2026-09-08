import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {RecorderManager} from "./recorder.mjs";

const host=process.env.CAMERA_SERVER_HOST||"127.0.0.1",port=Number(process.env.CAMERA_SERVER_PORT||8789),storageRoot=path.resolve(process.env.CAMERA_STORAGE_ROOT||"./camera-storage"),serverKey=String(process.env.CAMERA_SERVER_KEY||"").trim(),segmentSeconds=Math.max(30,Number(process.env.CAMERA_SEGMENT_SECONDS||300));
fs.mkdirSync(storageRoot,{recursive:true});
const recorders=new RecorderManager({storageRoot,ffmpeg:process.env.FFMPEG_BIN||"ffmpeg",segmentSeconds}),startedAt=new Date().toISOString();
function storage(){const stat=fs.statfsSync(storageRoot);return{root:storageRoot,totalBytes:Number(stat.blocks)*Number(stat.bsize),freeBytes:Number(stat.bavail)*Number(stat.bsize)}}
function send(res,status,body){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(body))}
async function json(req){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw new Error("Request body too large")}return raw?JSON.parse(raw):{}}
function authorized(req){return!!serverKey&&req.headers["x-ledgerly-server-key"]===serverKey}
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url||"/",`http://${req.headers.host||`${host}:${port}`}`);
  if(req.method==="GET"&&url.pathname==="/health")return send(res,200,{data:{service:"ledgerly-camera-server",version:"0.2.0",status:"ready",startedAt,storage:storage(),activeRecorders:recorders.list().length,capabilities:["local-storage","health-api","ffmpeg-segment-recording"]}});
  if(req.method==="GET"&&url.pathname==="/v1/storage")return send(res,200,{data:storage()});
  if(req.method==="GET"&&url.pathname==="/v1/recorders")return send(res,200,{data:recorders.list()});
  const match=/^\/v1\/cameras\/([A-Za-z0-9_-]+)\/recording\/(start|stop|status)$/.exec(url.pathname);
  if(match){const[,cameraId,action]=match;if(action==="status"&&req.method==="GET")return send(res,200,{data:recorders.status(cameraId)});if(req.method!=="POST")return send(res,405,{error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}});if(!authorized(req))return send(res,401,{error:{code:"SERVER_KEY_REQUIRED",message:"Set CAMERA_SERVER_KEY and send X-Ledgerly-Server-Key"}});if(action==="start"){const body=await json(req);return send(res,200,{data:recorders.start(cameraId,String(body.inputUrl||""))})}return send(res,200,{data:recorders.stop(cameraId)})}
  return send(res,404,{error:{code:"NOT_FOUND",message:"Camera server route not found"}})
}catch(error){return send(res,500,{error:{code:"CAMERA_SERVER_ERROR",message:error instanceof Error?error.message:String(error)}})}});
server.listen(port,host,()=>console.log(`[ledgerly-camera-server] listening on http://${host}:${port}; storage=${storageRoot}`));
for(const signal of["SIGINT","SIGTERM"]){process.on(signal,()=>{recorders.stopAll();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),6000).unref()})}
