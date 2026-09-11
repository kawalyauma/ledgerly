export const MODULE_REGISTRY_RELATIONSHIP_CHECKS = Object.freeze([
  ["module_registry.organization", `SELECT count(*)::bigint AS count FROM organization_modules x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["module_registry.module", `SELECT count(*)::bigint AS count FROM organization_modules x LEFT JOIN app_modules p ON p.module_key=x.module_key WHERE p.module_key IS NULL`],
]);
