import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import schoolFilesRoute from '../src/http/routes/school-files.route.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';

function streamRequest(bytes,{method='GET',headers={}}={}){const stream=Readable.from(bytes?[bytes]:[]);stream.method=method;stream.headers=headers;return stream;}
function multipart({name='evidence.txt',type='text/plain',purpose='academic-evidence',content='hello'}){
  const boundary='----ledgerly-school-files-test';
  const body=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`);
  return{body,headers:{'content-type':`multipart/form-data; boundary=${boundary}`,'content-length':String(body.length)}};
}
function runtime({database,storage,audit={async write(){}}}){return{
  auth:{async authenticateRequest(){return{organizationId:'org_1',userId:'usr_1',role:'owner',scopes:['school:read','school:write']};},requireScope(){return true;}},
  services:{database,audit},
  tenantStorage:{forOrganization(org){assert.equal(org,'org_1');return storage;}},
};}

test('School files route is registered behind its own business cutover',()=>{
  const route=listHttpRouteDescriptors().find(item=>item.name==='school-files');
  assert.equal(route?.prefix,'/api/v1/school/files');
  assert.equal(route?.business,true);
  const defaults=createHttpCutoverCapabilities({extensions:{}});
  assert.equal(defaults.state('school.files'),'cloudflare');
  const node=createHttpCutoverCapabilities({extensions:{'school-platform':{filesCutover:'node'}}});
  assert.equal(node.state('school.files'),'node');
  assert.equal(node.state('school.reference.read'),'cloudflare');
  assert.equal(node.state('school.reference.write'),'cloudflare');
  assert.equal(node.state('school.people.write'),'cloudflare');
});

test('School file upload writes tenant-scoped MinIO content and Cloudflare-compatible metadata',async()=>{
  let insertValues=null,stored=null,audited=null;
  const database={async query(sql,values=[]){if(sql.includes('INSERT INTO school_files')){insertValues=values;return{rows:[],rowCount:1};}throw new Error(`Unexpected SQL: ${sql}`);}};
  const storage={async put(key,bytes,metadata){stored={key,bytes:Buffer.from(bytes),metadata};return{key};},async delete(){throw new Error('delete should not run');}};
  const audit={async write(event){audited=event;}};
  const form=multipart({content:'lesson evidence'}),request=streamRequest(form.body,{method:'POST',headers:form.headers});
  const result=await schoolFilesRoute.handle({request,url:new URL('http://localhost/api/v1/school/files'),requestId:'req_files_1',runtime:runtime({database,storage,audit}),config:{}});
  assert.equal(result.status,201);
  assert.equal(result.body.data.originalName,'evidence.txt');
  assert.equal(result.body.data.mimeType,'text/plain');
  assert.equal(result.body.data.purpose,'academic-evidence');
  assert.match(result.body.data.id,/^sfl_[a-f0-9]{32}$/);
  assert.equal(result.body.data.contentUrl,`/api/v1/school/files/${result.body.data.id}/content`);
  assert.equal(stored.bytes.toString(),'lesson evidence');
  assert.match(stored.key,new RegExp(`/(${result.body.data.id})/evidence\\.txt$`));
  assert.equal(stored.metadata.contentType,'text/plain');
  assert.equal(insertValues[0],result.body.data.id);
  assert.equal(insertValues[1],'org_1');
  assert.equal(insertValues[8],'usr_1');
  assert.equal(audited.action,'school.file.uploaded');
  assert.equal(audited.requestId,'req_files_1');
});

test('School file content is streamed through the authenticated API instead of exposing MinIO hostnames',async()=>{
  const database={async query(sql,values){if(sql.includes('FROM school_files WHERE id=$1'))return{rows:[{id:values[0],object_key:'school/2026/09/sfl_1/evidence.txt',original_name:'evidence.txt',mime_type:'text/plain',size_bytes:5,checksum_sha256:'abc123',purpose:'academic-evidence',created_at:new Date()}]};throw new Error(`Unexpected SQL: ${sql}`);}};
  const storage={async get(key){assert.equal(key,'school/2026/09/sfl_1/evidence.txt');return Buffer.from('hello');}};
  const request=streamRequest(null,{method:'GET',headers:{authorization:'Bearer test'}});
  const result=await schoolFilesRoute.handle({request,url:new URL('http://localhost/api/v1/school/files/sfl_1/content'),requestId:'req_files_2',runtime:runtime({database,storage}),config:{}});
  assert.equal(result.status,200);
  assert.equal(Buffer.from(result.rawBody).toString(),'hello');
  assert.equal(result.headers['content-type'],'text/plain');
  assert.equal(result.headers['content-disposition'],'inline; filename="evidence.txt"');
});
