import {ensureAuthCoreSchema} from '../auth-core-schema.mjs';
import {FINANCE_CORE_TABLES} from '../finance-core-manifest.mjs';
import {ensureFinanceCoreSchema} from '../finance-core-schema.mjs';
import {ensureFinanceCoreIntegritySchema} from '../finance-core-integrity-schema.mjs';
import {FINANCE_CORE_RELATIONSHIP_CHECKS} from '../finance-core-validators.mjs';

export default {
  name:'finance-core',
  description:'Authoritative finance contacts, products, journals, documents, payments and allocations',
  prerequisites:['auth-core'],
  tables:FINANCE_CORE_TABLES,
  ensureSchema:async database=>{await ensureAuthCoreSchema(database);await ensureFinanceCoreSchema(database);await ensureFinanceCoreIntegritySchema(database);},
  finalizeSchema:null,
  relationshipChecks:FINANCE_CORE_RELATIONSHIP_CHECKS,
};
