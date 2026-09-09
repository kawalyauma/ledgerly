import fs from "node:fs";
import path from "node:path";
const root=path.resolve(new URL("..",import.meta.url).pathname,"..");
const required=["package.json","mediamtx.yml","docker-compose.yml","install/install.sh","install/camera.env.example","install/ledgerly-camera.service","install/ledgerly-camera-health.service","install/ledgerly-camera-health.timer","src/index.mjs","src/cloud.mjs","src/validation.mjs","src/backup.mjs"];
const failures=[];for(const rel of required){const file=path.join(root,rel);if(!fs.existsSync(file))failures.push(`missing ${rel}`)}
const media=fs.readFileSync(path.join(root,"mediamtx.yml"),"utf8"),compose=fs.readFileSync(path.join(root,"docker-compose.yml"),"utf8"),env=fs.readFileSync(path.join(root,"install/camera.env.example"),"utf8"),service=fs.readFileSync(path.join(root,"install/ledgerly-camera.service"),"utf8");
if(!/authMethod:\s*http/.test(media))failures.push("MediaMTX HTTP authentication is not enabled");
if(!/8889/.test(media))failures.push("MediaMTX WebRTC listener is not declared");
if(!/8554/.test(media))failures.push("MediaMTX RTSP listener is not declared");
if(!/CAMERA_STORAGE_ROOT/.test(compose))failures.push("docker-compose does not bind CAMERA_STORAGE_ROOT");
for(const key of ["LEDGERLY_API_URL","CAMERA_STORAGE_ROOT","CAMERA_SERVER_PUBLIC_URL"]){if(!env.includes(key))failures.push(`camera.env.example missing ${key}`)}
if(!/Restart=always/.test(service))failures.push("systemd camera service is not configured for automatic restart");
if(failures.length){console.error("Ledgerly Camera NVR package smoke check failed:\n- "+failures.join("\n- "));process.exit(1)}
console.log(`Ledgerly Camera NVR package smoke check passed (${required.length} required artifacts).`);
