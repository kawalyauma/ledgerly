import {PRINTERLY_TABLES} from '../printerly-manifest.mjs';
import {ensurePrinterlySchema} from '../printerly-schema.mjs';
import {PRINTERLY_RELATIONSHIP_CHECKS} from '../printerly-validators.mjs';
import {ensurePrinterlyRuntimeSchema} from '../../printerly/runtime-schema.mjs';

// D1 added smart-routing pools after jobs. PostgreSQL enforces the pool FK, so
// migrate pools first even though the source migration chronology is later.
const early = ['prn_nodes','prn_printers','prn_printer_pools','prn_printer_pool_members','prn_jobs'];
const byName = new Map(PRINTERLY_TABLES.map(table => [table.name, table]));
const earlySet = new Set(early);
const tables = Object.freeze([
  ...early.map(name => byName.get(name)),
  ...PRINTERLY_TABLES.filter(table => !earlySet.has(table.name)),
]);

async function ensureSchema(database){
  await ensurePrinterlySchema(database);
  await ensurePrinterlyRuntimeSchema(database);
}

export default {
  name:'printerly',
  description:'Printerly print/scan queue, accounting, governance, quotas, routing, secure release, retention, supplies, procurement and service desk',
  prerequisites:['finance-core'],
  tables,
  ensureSchema,
  finalizeSchema:null,
  relationshipChecks:PRINTERLY_RELATIONSHIP_CHECKS,
};
