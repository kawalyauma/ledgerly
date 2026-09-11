import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_REGISTRY_TABLES } from "../src/migration/module-registry-manifest.mjs";
import { getMigrationPhase } from "../src/migration/phases.mjs";

test("school configuration preserves the generic module registry introduced by school management", () => {
  const names = getMigrationPhase("school-configuration").tables.map((item) => item.name);
  assert.ok(names.includes("app_modules"));
  assert.ok(names.includes("organization_modules"));
  assert.ok(names.indexOf("app_modules") < names.indexOf("organization_modules"));
});

test("module registry transforms SQLite integer flags to PostgreSQL booleans", () => {
  const appModule = MODULE_REGISTRY_TABLES.find((item) => item.name === "app_modules").transform({ module_key: "school-management", core: 0, active: 1 });
  assert.equal(appModule.module_key, "school-management");
  assert.equal(appModule.core, false);
  assert.equal(appModule.active, true);
  const organizationModule = MODULE_REGISTRY_TABLES.find((item) => item.name === "organization_modules").transform({ organization_id: "org", module_key: "school-management", enabled: 1 });
  assert.equal(organizationModule.enabled, true);
});
