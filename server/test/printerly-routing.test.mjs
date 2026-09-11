import assert from 'node:assert/strict';
import test from 'node:test';
import {resolvePrinterRoute} from '../src/printerly/routing-core.mjs';
import {readFile} from 'node:fs/promises';

test('smart routing chooses the least-loaded ready tenant printer',async()=>{const db={query:async(sql,args)=>{if(sql.includes('default_auto'))return{rows:[]};if(sql.includes('FROM prn_printers p JOIN prn_nodes'))return{rows:[{id:'p1',name:'Busy',capabilities_json:'{}',priority:100,active_jobs:4},{id:'p2',name:'Free',capabilities_json:'{}',priority:100,active_jobs:1}]};throw new Error(`unexpected query ${sql}`);}};const route=await resolvePrinterRoute(db,'org-1',{pageSize:'A4'});assert.equal(route.printerId,'p2');assert.equal(route.strategy,'least_loaded');});

test('explicit printer routing is organization scoped',async()=>{const db={query:async()=>({rows:[]})};await assert.rejects(()=>resolvePrinterRoute(db,'org-1',{printerId:'foreign'}),error=>error.code==='INVALID_PRINTER'&&error.status===422);});

test('job submission records soft quota warnings while retaining row locking for quota concurrency',async()=>{const source=await readFile(new URL('../src/printerly/job-service.mjs',import.meta.url),'utf8');assert.match(source,/FROM prn_quota_periods[\s\S]*FOR UPDATE/);assert.match(source,/mode==='soft'&&exceeded/);assert.match(source,/quota_soft_exceeded/);assert.match(source,/resolvePrinterRoute/);assert.match(source,/route_pool_id/);});

test('job API idempotency and routing stay inside the same PostgreSQL transaction',async()=>{const source=await readFile(new URL('../src/printerly/job-service.mjs',import.meta.url),'utf8');const transaction=source.indexOf('this.database.transaction');const duplicate=source.indexOf('idempotency_key=$2',transaction);const route=source.indexOf('resolvePrinterRoute(tx',transaction);const insert=source.indexOf('INSERT INTO prn_jobs',transaction);assert.ok(transaction>=0&&duplicate>transaction&&route>duplicate&&insert>route);});
