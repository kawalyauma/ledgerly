import assert from 'node:assert/strict';import test from 'node:test';
import {secureReleasePin} from '../src/printerly/node-service.mjs';

test('secure release PINs are six cryptographically generated digits',()=>{for(let i=0;i<100;i++)assert.match(secureReleasePin(),/^\d{6}$/);});

test('Printerly legacy route is disabled unless cutover is explicitly node',async()=>{const route=(await import('../src/http/routes/printerly.route.mjs')).default;assert.equal(route.business,true);assert.equal(route.enabled({extensions:{printerly:{cutover:'cloudflare'}}}),false);assert.equal(route.enabled({extensions:{printerly:{cutover:'shadow'}}}),false);assert.equal(route.enabled({extensions:{printerly:{cutover:'node'}}}),true);});
