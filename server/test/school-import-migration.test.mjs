import test from "node:test";
import assert from "node:assert/strict";
import { SCHOOL_IMPORT_TABLES } from "../src/migration/school-import-manifest.mjs";
import { getMigrationPhase } from "../src/migration/phases.mjs";
test("school people phase preserves student import job history",()=>{const names=getMigrationPhase("school-people").tables.map(x=>x.name);assert.ok(names.includes("school_import_jobs"));const transformed=SCHOOL_IMPORT_TABLES[0].transform({id:"import-1",organization_id:"org",status:"completed",total_rows:10});assert.equal(transformed.id,"import-1");assert.equal(transformed.total_rows,10);});
