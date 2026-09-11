import {SCHOOL_FEES_TABLES} from '../school-fees-manifest.mjs';
import {ensureSchoolFeesSchema} from '../school-fees-schema.mjs';
import {SCHOOL_FEES_RELATIONSHIP_CHECKS} from '../school-fees-validators.mjs';

export default {
  name:'school-fees',
  description:'School fee structures, billing, receipts, archive, reversals and mobile receipt intents',
  prerequisites:['finance-core','school-reference'],
  tables:SCHOOL_FEES_TABLES,
  ensureSchema:ensureSchoolFeesSchema,
  finalizeSchema:null,
  relationshipChecks:SCHOOL_FEES_RELATIONSHIP_CHECKS,
};
