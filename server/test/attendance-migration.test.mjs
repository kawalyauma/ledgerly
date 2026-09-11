import test from "node:test";
import assert from "node:assert/strict";
import { ATTENDANCE_TABLES } from "../src/migration/attendance-manifest.mjs";
import { getMigrationPhase } from "../src/migration/phases.mjs";

const byName = (name) => ATTENDANCE_TABLES.find((item) => item.name === name);

test("attendance phase keeps legacy first and canonical dependencies ordered", () => {
  const phase = getMigrationPhase("attendance");
  assert.deepEqual(phase.prerequisites,["auth-core","school-reference","school-configuration","school-people","school-staff"]);
  const names=phase.tables.map((item)=>item.name);
  assert.ok(names.indexOf("school_student_attendance_sessions") < names.indexOf("att_sessions"));
  assert.ok(names.indexOf("att_devices") < names.indexOf("att_device_sync_batches"));
  assert.ok(names.indexOf("att_biometric_profiles") < names.indexOf("att_biometric_templates"));
});

test("attendance transforms preserve offline IDs and integer booleans", () => {
  const event=byName("att_events").transform({id:"evt-device-42",organization_id:"org",official:0,client_event_id:"client-77"});
  assert.equal(event.id,"evt-device-42");
  assert.equal(event.client_event_id,"client-77");
  assert.equal(event.official,false);
  const batch=byName("att_device_sync_batches").transform({id:"batch-1",organization_id:"org",client_batch_id:"offline-batch-9"});
  assert.equal(batch.client_batch_id,"offline-batch-9");
  const grant=byName("att_test_mode_grants").transform({id:"g",organization_id:"org",allow_screen_image:1,allow_printed_image:0});
  assert.equal(grant.allow_screen_image,true);
  assert.equal(grant.allow_printed_image,false);
});

test("attendance final manifest contains mobile reconciliation and QR/face metadata", () => {
  const names=ATTENDANCE_TABLES.map((item)=>item.name);
  for(const name of ["att_device_enrollment_tokens","att_biometric_templates","att_biometric_template_samples","att_biometric_enrollment_jobs","att_mobile_reconciliation_issues"]) assert.ok(names.includes(name),name);
  assert.ok(byName("att_events").columns.includes("mobile_sync_device_id"));
});
