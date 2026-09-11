import test from "node:test";
import assert from "node:assert/strict";
import { KindRoutingQueue } from "../src/adapters/kind-routing-queue.mjs";
import { listRuntimeExtensionDescriptors } from "../src/extensions.mjs";
import { createHttpRouteRegistry, listHttpRouteDescriptors } from "../src/http/routes.mjs";

test("scheduler kind routing sends registered job kinds to their dedicated queue", async () => {
  const calls = [];
  const defaultQueue = { async enqueue(job) { calls.push(["default", job.kind]); return "default"; } };
  const aiQueue = { async enqueue(job) { calls.push(["ai", job.kind]); return "ai"; } };
  const routed = new KindRoutingQueue({ defaultQueue, routes: { "ai.task": aiQueue } });

  assert.equal(await routed.enqueue({ kind: "ai.task" }), "ai");
  assert.equal(await routed.enqueue({ kind: "reports.generate" }), "default");
  assert.deepEqual(calls, [["ai", "ai.task"], ["default", "reports.generate"]]);
});

test("drop-in descriptor registries expose unique names and prefixes", () => {
  const extensions = listRuntimeExtensionDescriptors();
  assert.equal(new Set(extensions.map((item) => item.name)).size, extensions.length);

  const routes = listHttpRouteDescriptors();
  assert.equal(new Set(routes.map((item) => item.name)).size, routes.length);
  assert.equal(new Set(routes.map((item) => item.prefix)).size, routes.length);
  for (const route of routes) assert.match(route.prefix, /^\/selfhost\//);
});

test("HTTP registry leaves unknown self-hosted paths untouched", async () => {
  const registry = await createHttpRouteRegistry({ runtime: {}, config: {} });
  const response = await registry.dispatch({
    request: { method: "GET" },
    url: new URL("http://localhost/selfhost/__integration_registry_probe__"),
    requestId: "test",
  });
  assert.equal(response, null);
});
