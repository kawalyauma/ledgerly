import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCaddySecurity,
  evaluateComposeExposure,
  parseComposeSurface,
  parsePortBinding,
} from "../src/readiness/security-exposure.mjs";

const baseCompose = `
services:
  postgres:
    ports:
      - "127.0.0.1:\${POSTGRES_HOST_PORT:-5432}:5432"
  pgbouncer:
    ports:
      - "127.0.0.1:\${PGBOUNCER_HOST_PORT:-6432}:6432"
  redis:
    ports:
      - "127.0.0.1:\${REDIS_HOST_PORT:-6379}:6379"
  minio:
    ports:
      - "127.0.0.1:\${MINIO_API_HOST_PORT:-9000}:9000"
      - "127.0.0.1:\${MINIO_CONSOLE_HOST_PORT:-9001}:9001"
  api:
    ports:
      - "127.0.0.1:\${LEDGERLY_API_PORT:-8788}:8788"
  caddy:
    ports:
      - "\${LEDGERLY_HTTP_PORT:-8080}:80"
      - "\${LEDGERLY_HTTPS_PORT:-8443}:443"
networks:
  ledgerly_backend:
    internal: true
`;

const financeOverlay = `
services:
  nvr-mediamtx:
    ports:
      - "127.0.0.1:\${CAMERA_RTSP_HOST_PORT:-8554}:8554"
      - "127.0.0.1:\${CAMERA_HLS_HOST_PORT:-8888}:8888"
      - "127.0.0.1:\${CAMERA_WEBRTC_HTTP_HOST_PORT:-8889}:8889"
      - "\${CAMERA_WEBRTC_UDP_PORT:-8189}:8189/udp"
networks:
  ledgerly_backend:
    external: false
`;

test("port parser handles compose default-value substitutions", () => {
  assert.deepEqual(parsePortBinding("127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432"), {
    raw: "127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432",
    host: "127.0.0.1",
    published: "${POSTGRES_HOST_PORT:-5432}",
    containerPort: "5432",
    protocol: "tcp",
    public: false,
  });
  assert.equal(parsePortBinding("${CAMERA_WEBRTC_UDP_PORT:-8189}:8189/udp").public, true);
  assert.equal(parsePortBinding("${CAMERA_WEBRTC_UDP_PORT:-8189}:8189/udp").containerPort, "8189");
});

test("current base and NVR exposure policy passes", () => {
  const base = parseComposeSurface(baseCompose, { filename: "compose.selfhost.yml" });
  const overlay = parseComposeSurface(financeOverlay, { filename: "compose.finance-runtime.yml" });
  const result = evaluateComposeExposure({ base, overlays: [overlay] });
  assert.equal(result.ok, true, result.failures.join("\n"));
});

test("public database binding fails closed", () => {
  const unsafe = baseCompose.replace(
    '127.0.0.1:${POSTGRES_HOST_PORT:-5432}:5432',
    '${POSTGRES_HOST_PORT:-5432}:5432',
  );
  const result = evaluateComposeExposure({ base: parseComposeSurface(unsafe, { filename: "unsafe.yml" }) });
  assert.equal(result.ok, false);
  assert(result.failures.some((failure) => failure.includes("postgres:PRIVATE_PORT_PUBLIC")));
});

test("unknown public service port is rejected", () => {
  const overlay = parseComposeSurface(`
services:
  debug-console:
    ports:
      - "9999:9999"
`, { filename: "debug.yml" });
  const result = evaluateComposeExposure({
    base: parseComposeSurface(baseCompose, { filename: "compose.selfhost.yml" }),
    overlays: [overlay],
  });
  assert.equal(result.ok, false);
  assert(result.failures.some((failure) => failure.includes("UNAPPROVED_PUBLIC_PORT")));
});

test("backend network must remain internal", () => {
  const unsafe = baseCompose.replace("internal: true", "internal: false");
  const result = evaluateComposeExposure({ base: parseComposeSurface(unsafe, { filename: "unsafe.yml" }) });
  assert.equal(result.ok, false);
  assert(result.failures.includes("BASE_BACKEND_NETWORK_NOT_INTERNAL"));
});

test("Caddy edge security requires admin off and hardening headers", () => {
  const good = `
{
  admin off
}
example.test {
  header {
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy no-referrer
    -Server
  }
  reverse_proxy api:8788
}
`;
  assert.equal(evaluateCaddySecurity(good).ok, true);
  const bad = good.replace("admin off", "admin 0.0.0.0:2019").replace("X-Frame-Options DENY", "");
  const result = evaluateCaddySecurity(bad);
  assert.equal(result.ok, false);
  assert(result.failures.includes("CADDY_ADMIN_NOT_DISABLED"));
  assert(result.failures.includes("CADDY_FRAME_DENY_HEADER_MISSING"));
});
