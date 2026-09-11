import { AUTH_CORE_TABLES } from "../auth-core-manifest.mjs";
import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { AUTH_CORE_RELATIONSHIP_CHECKS } from "../validators.mjs";

export default {
  name: "auth-core",
  description: "Organizations, users, memberships, accounts and authentication/security data",
  prerequisites: [],
  tables: AUTH_CORE_TABLES,
  ensureSchema: ensureAuthCoreSchema,
  finalizeSchema: null,
  relationshipChecks: AUTH_CORE_RELATIONSHIP_CHECKS,
};
