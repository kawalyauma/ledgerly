import { migrationTable } from "./shared-manifest-utils.mjs";

export const CONTACTS_TABLES = Object.freeze([
  migrationTable({name:"contacts",columns:["id","organization_id","type","code","name","email","tax_number","payment_terms_days","active","custom_fields","created_at","updated_at","credit_limit_minor","pricing_tier","archived_at"],conflict:["id"],booleans:["active"],dependencies:["organizations"]}),
  migrationTable({name:"contact_addresses",columns:["id","organization_id","contact_id","type","line1","line2","city","state","postal_code","country","is_default","created_at","updated_at"],conflict:["id"],booleans:["is_default"],dependencies:["organizations","contacts"]}),
  migrationTable({name:"contact_people",columns:["id","organization_id","contact_id","name","email","phone","role","is_primary","created_at","updated_at"],conflict:["id"],booleans:["is_primary"],dependencies:["organizations","contacts"]}),
]);
