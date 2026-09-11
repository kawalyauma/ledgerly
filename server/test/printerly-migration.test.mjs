import assert from 'node:assert/strict';
import test from 'node:test';
import phase from '../src/migration/phases/printerly.phase.mjs';
import {PRINTERLY_TABLES} from '../src/migration/printerly-manifest.mjs';
import {ensurePrinterlySchema} from '../src/migration/printerly-schema.mjs';

test('printerly phase covers the authoritative operational chain',()=>{
  const names=new Set(PRINTERLY_TABLES.map(table=>table.name));
  for(const name of [
    'prn_nodes','prn_printers','prn_jobs','prn_documents','prn_cost_ledger','prn_cost_postings',
    'prn_scanners','prn_scan_jobs','prn_quotas','prn_quota_reservations','prn_print_rules','prn_approvals',
    'prn_batches','prn_printer_pools','prn_release_credentials','prn_retention_policies','prn_consumables',
    'prn_maintenance_events','prn_purchase_requests','prn_purchase_receipts','prn_service_tickets'
  ]) assert.ok(names.has(name),name);
  assert.deepEqual(phase.prerequisites,['finance-core']);
  assert.ok(phase.relationshipChecks.length>=10);
});

test('printerly migration converts D1 boolean integers',()=>{
  const jobs=PRINTERLY_TABLES.find(table=>table.name==='prn_jobs');
  const transformed=jobs.transform({id:'j1',organization_id:'o1',duplex:1,secure_release:0});
  assert.equal(transformed.duplex,true);
  assert.equal(transformed.secure_release,false);
});

test('smart routing pools migrate before jobs with PostgreSQL FKs',()=>{
  const names=phase.tables.map(table=>table.name);
  assert.ok(names.indexOf('prn_printer_pools')<names.indexOf('prn_jobs'));
  assert.ok(names.indexOf('prn_printers')<names.indexOf('prn_jobs'));
});

test('PostgreSQL Printerly schema includes governance and transactional constraints',async()=>{
  let sql='';
  await ensurePrinterlySchema({query:async text=>{sql+=text;return {rows:[]};}});
  assert.match(sql,/CREATE TABLE IF NOT EXISTS prn_quota_reservations/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS prn_release_credentials/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS prn_purchase_receipt_lines/);
  assert.match(sql,/quantity_received<=quantity_requested/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS prn_service_tickets/);
  assert.match(sql,/timestamptz/);
  assert.doesNotMatch(sql,/INTEGER NOT NULL DEFAULT 0 CHECK\(.*IN \(0,1\)/i);
});
