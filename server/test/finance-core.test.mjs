import assert from "node:assert/strict";
import test from "node:test";
import { FINANCE_CORE_TABLES, getFinanceCoreTable } from "../src/migration/finance-core-manifest.mjs";

test("finance migration manifest preserves dependency ordering", () => {
  const position = new Map(FINANCE_CORE_TABLES.map((table, index) => [table.name,index]));
  assert.equal(new Set(position.keys()).size, FINANCE_CORE_TABLES.length);
  for (const table of FINANCE_CORE_TABLES) {
    for (const dependency of table.dependencies) {
      if (dependency === "organizations" || dependency === "accounts") continue;
      assert.ok(position.has(dependency), `${table.name} depends on missing ${dependency}`);
      assert.ok(position.get(dependency) < position.get(table.name), `${dependency} must precede ${table.name}`);
    }
  }
});

test("finance manifest converts D1 integer booleans and retains bigint-safe values", () => {
  const product = getFinanceCoreTable("products").transform({
    id:"prod_1", organization_id:"org_1", sku:"A", name:"A", type:"service",
    active:0, quantity_on_hand_micros:9007199254740991n,
  });
  assert.equal(product.active,false);
  assert.equal(product.quantity_on_hand_micros,9007199254740991n);
});

test("payment allocation migration depends on payment and document truth", () => {
  const allocation = getFinanceCoreTable("payment_allocations");
  assert.deepEqual(allocation.dependencies,["organizations","payments","documents"]);
  assert.deepEqual(allocation.conflict,["id"]);
});
