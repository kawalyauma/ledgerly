import assert from "node:assert/strict";
import test from "node:test";

import { evaluateComposeExposure, parseComposeSurface } from "../src/readiness/security-exposure.mjs";

const inlineBase = `
services:
  postgres:
    ports: ["127.0.0.1:\${POSTGRES_HOST_PORT:-5432}:5432"]
  pgbouncer:
    ports: ["127.0.0.1:\${PGBOUNCER_HOST_PORT:-6432}:6432"]
  redis:
    ports: ["127.0.0.1:\${REDIS_HOST_PORT:-6379}:6379"]
  api:
    ports: ["127.0.0.1:\${LEDGERLY_API_PORT:-8788}:8788"]
  caddy:
    ports: ["\${LEDGERLY_HTTP_PORT:-8080}:80", "\${LEDGERLY_HTTPS_PORT:-8443}:443"]
networks:
  ledgerly_backend:
    internal: true
`;

test("inline port arrays remain visible to the exposure policy", () => {
  const surface = parseComposeSurface(inlineBase, { filename: "compose.selfhost.yml" });
  assert.deepEqual(surface.services.find((service) => service.name === "postgres")?.ports, [
    "127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432",
  ]);
  assert.deepEqual(surface.services.find((service) => service.name === "caddy")?.ports, [
    "${LEDGERLY_HTTP_PORT:-8080}:80",
    "${LEDGERLY_HTTPS_PORT:-8443}:443",
  ]);
  const result = evaluateComposeExposure({ base: surface });
  assert.equal(result.ok, true, result.failures.join("\n"));
});

test("unsafe inline private-service publication fails closed", () => {
  const unsafe = inlineBase.replace(
    'ports: ["127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432"]',
    'ports: ["${POSTGRES_HOST_PORT:-5432}:5432"]',
  );
  const result = evaluateComposeExposure({
    base: parseComposeSurface(unsafe, { filename: "unsafe-inline.yml" }),
  });
  assert.equal(result.ok, false);
  assert(result.failures.some((failure) => failure.includes("postgres:PRIVATE_PORT_PUBLIC")));
});
