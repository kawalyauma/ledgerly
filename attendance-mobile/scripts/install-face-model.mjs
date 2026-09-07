import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import https from 'node:https';

const url='https://github.com/shubham0204/FaceRecognition_With_FaceNet_Android/raw/refs/heads/master/app/src/main/assets/facenet.tflite';
const expectedGitBlob='8254aabae5cc73b8d2c15e7c589730eb3c264b87';
const destination=resolve('android/app/src/main/assets/facenet.tflite');
function download(target,redirects=0){return new Promise((ok,fail)=>{https.get(target,{headers:{'User-Agent':'Ledgerly-Attendance-Model-Installer'}},res=>{if(res.statusCode&&[301,302,303,307,308].includes(res.statusCode)&&res.headers.location){if(redirects>6)return fail(new Error('Too many redirects'));res.resume();return ok(download(new URL(res.headers.location,target).toString(),redirects+1))}if(res.statusCode!==200){res.resume();return fail(new Error(`Download failed with HTTP ${res.statusCode}`))}const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>ok(Buffer.concat(chunks)));res.on('error',fail)}).on('error',fail)})}
const bytes=await download(url);
const header=Buffer.from(`blob ${bytes.length}\0`);
const actual=createHash('sha1').update(header).update(bytes).digest('hex');
if(actual!==expectedGitBlob)throw new Error(`Face model integrity check failed. Expected Git blob ${expectedGitBlob}, got ${actual}`);
await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
console.log(`Installed FaceNet model: ${destination}`);console.log(`Bytes: ${bytes.length.toLocaleString()} · verified Git blob ${actual}`);
