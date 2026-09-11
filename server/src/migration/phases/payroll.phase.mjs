import {PAYROLL_TABLES} from '../payroll-manifest.mjs';
import {ensurePayrollSchema} from '../payroll-schema.mjs';
import {PAYROLL_RELATIONSHIP_CHECKS} from '../payroll-validators.mjs';

export default {
  name:'payroll',
  description:'Standalone payroll employees, rules, runs, lines, payments and mobile intents',
  prerequisites:['finance-core'],
  tables:PAYROLL_TABLES,
  ensureSchema:ensurePayrollSchema,
  finalizeSchema:null,
  relationshipChecks:PAYROLL_RELATIONSHIP_CHECKS,
};
