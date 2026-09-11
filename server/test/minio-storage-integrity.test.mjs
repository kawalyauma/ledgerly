import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {MinioStorage} from '../src/adapters/minio-storage.mjs';

class FakeMinio {
  constructor(){this.objects=new Map();this.corruptSize=false;}
  async putObject(bucket,key,body,_size,headers){this.objects.set(`${bucket}/${key}`,{body:Buffer.from(body),headers:{...headers}});}
  async statObject(bucket,key){const item=this.objects.get(`${bucket}/${key}`);if(!item){const e=new Error('missing');e.code='NotFound';throw e;}return{size:item.body.length+(this.corruptSize?1:0),etag:'e',metaData:{sha256:item.headers['X-Amz-Meta-sha256']},lastModified:new Date()};}
  async getObject(bucket,key){const item=this.objects.get(`${bucket}/${key}`);return Readable.from([item.body]);}
  async removeObject(bucket,key){this.objects.delete(`${bucket}/${key}`);}
  listObjectsV2(){return Readable.from([],{objectMode:true});}
  async presignedGetObject(){return'https://example.invalid/object';}
  async bucketExists(){return true;}
}

test('MinIO writes persist sha256 metadata and verify size',async()=>{const client=new FakeMinio(),storage=new MinioStorage({client,bucket:'b'});const result=await storage.put('org/o1/a.txt',Buffer.from('abc'));assert.equal(result.verified,true);assert.equal(result.sha256.length,64);const head=await storage.head('org/o1/a.txt');assert.equal(head.sha256,result.sha256);assert.deepEqual(await storage.verify('org/o1/a.txt',{expectedSize:3,expectedSha256:result.sha256}),{ok:true,key:'org/o1/a.txt',size:3,sha256:result.sha256});});

test('MinIO rejects caller checksum metadata that does not match bytes',async()=>{const client=new FakeMinio(),storage=new MinioStorage({client,bucket:'b'});await assert.rejects(()=>storage.put('a',Buffer.from('abc'),{custom:{sha256:'bad'}}),/checksum/);});

test('MinIO write verification fails closed on size mismatch',async()=>{const client=new FakeMinio(),storage=new MinioStorage({client,bucket:'b'});client.corruptSize=true;await assert.rejects(()=>storage.put('a',Buffer.from('abc')),/size verification/);});
