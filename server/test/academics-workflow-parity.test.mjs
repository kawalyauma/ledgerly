import test from 'node:test';
import assert from 'node:assert/strict';

import { ACADEMICS_SCHEME_TRANSITIONS } from '../src/academics/parity-service.mjs';

test('Academics scheme workflow preserves the Cloudflare HOD then DOS approval stages',()=>{
  assert.deepEqual(ACADEMICS_SCHEME_TRANSITIONS.submit_hod,{from:['draft','rejected'],to:'submitted_hod'});
  assert.deepEqual(ACADEMICS_SCHEME_TRANSITIONS.hod_approve,{from:['submitted_hod'],to:'hod_approved'});
  assert.deepEqual(ACADEMICS_SCHEME_TRANSITIONS.submit_dos,{from:['hod_approved'],to:'submitted_dos'});
  assert.deepEqual(ACADEMICS_SCHEME_TRANSITIONS.dos_approve,{from:['submitted_dos'],to:'approved'});
  assert.deepEqual(ACADEMICS_SCHEME_TRANSITIONS.reject,{from:['submitted_hod','submitted_dos'],to:'rejected'});
  assert.equal(Object.hasOwn(ACADEMICS_SCHEME_TRANSITIONS,'submit'),false);
});
