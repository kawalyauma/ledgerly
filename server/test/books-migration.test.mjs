import test from "node:test";
import assert from "node:assert/strict";
import { BOOKS_TABLES } from "../src/migration/books-manifest.mjs";
import { getMigrationPhase } from "../src/migration/phases.mjs";
test("books phase depends on school people and preserves mobile intents",()=>{const phase=getMigrationPhase("books");assert.deepEqual(phase.prerequisites,["auth-core","school-reference","school-configuration","school-people"]);const names=BOOKS_TABLES.map(x=>x.name);assert.ok(names.indexOf("bks_distribution_batches")<names.indexOf("bks_distributions"));assert.ok(names.includes("bks_mobile_operation_intents"));});
test("books migration preserves stable offline intent identifiers",()=>{const intent=BOOKS_TABLES.find(x=>x.name==="bks_mobile_operation_intents").transform({id:"intent-device-17",organization_id:"org",device_id:"dev",operation_type:"bulk_issue",attempts:2});assert.equal(intent.id,"intent-device-17");assert.equal(intent.device_id,"dev");assert.equal(intent.attempts,2);});
