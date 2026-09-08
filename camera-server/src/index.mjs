import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {RecorderManager} from "./recorder.mjs";
import {RecordingCatalog} from "./catalog.mjs";
import {CloudCoordinator} from "./cloud.mjs";
import {ingestSegment} from "./ingest.mjs";

const host=process.env.CAMERA_SERVER_HOST||"0.0.0.0",port=Number(process.env.CAMERA_SERVER_PORT||8789),storageRoot=path.resolve(process.env.CAMERA_STORAGE_ROOT||"./camera-storage"),serverKey=String(process.env.CAMERA_SERVER_KEY||"").trim(),segmentSeconds=Math.max(30,Number(process.env.CAMERA_SEGMENT_SECONDS||300)),retentionDays=Math.max(1,Number(process.env.CAMERA_RETENTION_DAYS||30)),maxStoragePercent=Math.min(99,Math.max(50,Number(process.env.CAMERA_MAX_STORAGE_PERCENT||90))),localBaseUrl=String(process.env.CAMERA_LOCAL_BASE_URL||`http://127.0.0.1:${port}`).replace(/\/$/,"");
fs.mkdirSync(storageRoot,{recursive:true});
const recorders=new RecorderManager({storageRoot,ffmpeg:process.env.FFMPEG_BIN||"ffmpeg",segmentSeconds}),catalog=new RecordingCatalog({storageRoot,retentionDays,maxStoragePercent}),startedAt=new Date().toISOString();
function storage(){const stat=fs.statfsSync(storageRoot),totalBytes=Number(stat.blocks)*Number(stat.bsize),freeBytes=Number(stat.bavail)*Number(stat.bsize);return{root:storageRoot,totalBytes,freeBytes,usedBytes:totalBytes-freeBytes,usedPercent:totalBytes?Math.round((totalBytes-freeBytes)*10000/totalBytes)/100:0}}
const cloud=new CloudCoordinator({apiUrl:process.env.LEDGERLY_API_URL||"",stateFile:process.env.CAMERA_SERVER_STATE||"./camera-server-state.json",localBaseUrl,storage});
function send(res,status,body){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type,x-ledgerly-segment-start,x-ledgerly-segment-end,x-ledgerly-server-key"});res.end(JSON.stringify(body))}
async function json(req){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw new Error("Request body too large")}return raw?JSON.parse(raw):{}}
function authorized(req){return!!serverKey&&req.headers["x-ledgerly-server-key"]===serverKey}
function requireAuth(req,res){if(authorized(req))return true;send(res,401,{error:{code:"SERVER_KEY_REQUIRED",message:"Set CAMERA_SERVER_KEY and send X-Ledgerly-Server-Key"}});return false}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url||"/",`http://${req.headers.host||`${host}:${port}`}`);if(req.method==="OPTIONS")return send(res,204,{});
 if(req.method==="GET"&&url.pathname==="/health")return send(res,200,{data:{service:"ledgerly-camera-server",version:"0.4.0",status:"ready",paired:Boolean(cloud.registration),serverId:cloud.registration?.serverId||null,startedAt,storage:storage(),activeRecorders:recorders.list().length,assignedCameras:cloud.config.cameras?.length||0,retention:{days:retentionDays,maxStoragePercent},capabilities:["local-storage","lan-mp4-ingest","cloud-pairing","metadata-sync","recording-catalog","protected-segments","retention-cleanup","live-signaling-ready"]}});
 if(req.method==="GET"&&url.pathname==="/v1/storage")return send(res,200,{data:storage()});
 if(req.method==="GET"&&url.pathname==="/v1/assignments")return send(res,200,{data:cloud.config});
 const ingest=/^\/v1\/ingest\/([A-Za-z0-9_-]+)\/segments$/.exec(url.pathname);if(ingest&&req.method==="POST"){const row=await ingestSegment(req,{storageRoot,cloud,cameraId:ingest[1]});return send(res,201,{data:row})}
 if(req.method==="GET"&&url.pathname==="/v1/recorders")return send(res,200,{data:recorders.list()});
 if(req.method==="GET"&&url.pathname==="/v1/cameras")return send(res,200,{data:catalog.cameras().map(id=>catalog.summary(id))});
 if(req.method==="POST"&&url.pathname==="/v1/retention/cleanup"){if(!requireAuth(req,res))return;return send(res,200,{data:catalog.cleanup()})}
 const recordings=/^\/v1\/cameras\/([A-Za-z0-9_-]+)\/recordings$/.exec(url.pathname);if(recordings&&req.method==="GET")return send(res,200,{data:catalog.list(recordings[1],{from:url.searchParams.get("from"),to:url.searchParams.get("to"),limit:url.searchParams.get("limit")})});
 const summary=/^\/v1\/cameras\/([A-Za-z0-9_-]+)\/summary$/.exec(url.pathname);if(summary&&req.method==="GET")return send(res,200,{data:catalog.summary(summary[1])});
 const protect=/^\/v1\/cameras\/([A-Za-z0-9_-]+)\/recordings\/([^/]+)\/protect$/.exec(url.pathname);if(protect&&req.method==="POST"){if(!requireAuth(req,res))return;const body=await json(req);return send(res,200,{data:catalog.protect(protect[1],decodeURIComponent(protect[2]),body.protected!==false)})}
 const match=/^\/v1\/cameras\/([A-Za-z0-9_-]+)\/recording\/(start|stop|status)$/.exec(url.pathname);if(match){const[,cameraId,action]=match;if(action==="status"&&req.method==="GET")return send(res,200,{data:recorders.status(cameraId)});if(req.method!=="POST")return send(res,405,{error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}});if(!requireAuth(req,res))return;if(action==="start"){const body=await json(req);return send(res,200,{data:recorders.start(cameraId,String(body.inputUrl||""))})}return send(res,200,{data:recorders.stop(cameraId)})}
 return send(res,404,{error:{code:"NOT_FOUND",message:"Camera server route not found"}})}catch(error){return send(res,error?.status||500,{error:{code:error?.status===401?"CAMERA_INGEST_AUTH_FAILED":"CAMERA_SERVER_ERROR",message:error instanceof Error?error.message:String(error)}})}});
server.listen(port,host,async()=>{console.log(`[ledgerly-camera-server] listening on ${localBaseUrl}; storage=${storageRoot}`);try{await cloud.start(process.env.CAMERA_SERVER_PAIRING_TOKEN||"");if(!cloud.registration)console.log("[ledgerly-camera-server] unpaired: create an NVR pairing token in Ledgerly and set CAMERA_SERVER_PAIRING_TOKEN") }catch(e){console.error("[ledgerly-camera-server] cloud startup",e)}});
const cleanupTimer=setInterval(()=>{try{const result=catalog.cleanup();if(result.deleted)console.log(`[ledgerly-camera-server] retention deleted=${result.deleted} freed=${result.freedBytes}`)}catch(error){console.error("[ledgerly-camera-server] retention cleanup failed",error)}},Math.max(300000,Number(process.env.CAMERA_CLEANUP_INTERVAL_MS||3600000)));cleanupTimer.unref();
for(const signal of["SIGINT","SIGTERM"]){process.on(signal,()=>{clearInterval(cleanupTimer);cloud.stop();recorders.stopAll();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),6000).unref()})}
