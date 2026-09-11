import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];
const PRIVATE_SERVICE_NAMES = new Set(["postgres", "pgbouncer", "redis", "minio", "api"]);
const APPROVED_PUBLIC = Object.freeze({
  caddy: Object.freeze([
    { containerPort: "80", protocol: "tcp" },
    { containerPort: "443", protocol: "tcp" },
  ]),
  "nvr-mediamtx": Object.freeze([
    { containerPort: "8189", protocol: "udp" },
  ]),
});

function stripQuotes(value) {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

export function parseComposeSurface(source, { filename = "compose.yml" } = {}) {
  const services = new Map();
  const networks = new Map();
  let section = null;
  let service = null;
  let network = null;
  let inPorts = false;

  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = indentation(line);

    if (indent === 0 && /^(services|networks):\s*$/.test(trimmed)) {
      section = trimmed.slice(0, -1);
      service = null;
      network = null;
      inPorts = false;
      continue;
    }

    if (section === "services") {
      const serviceMatch = indent === 2 ? trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/) : null;
      if (serviceMatch) {
        service = serviceMatch[1];
        services.set(service, { name: service, ports: [], filename });
        inPorts = false;
        continue;
      }
      if (!service) continue;
      if (indent === 4 && trimmed === "ports:") {
        inPorts = true;
        continue;
      }
      if (indent <= 4 && trimmed !== "ports:") inPorts = false;
      if (inPorts && indent >= 6 && trimmed.startsWith("- ")) {
        services.get(service).ports.push(stripQuotes(trimmed.slice(2)));
      }
      continue;
    }

    if (section === "networks") {
      const networkMatch = indent === 2 ? trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/) : null;
      if (networkMatch) {
        network = networkMatch[1];
        networks.set(network, { name: network, internal: null, external: null, filename });
        continue;
      }
      if (!network) continue;
      const property = indent === 4 ? trimmed.match(/^(internal|external):\s*(true|false)\s*$/i) : null;
      if (property) networks.get(network)[property[1].toLowerCase()] = property[2].toLowerCase() === "true";
    }
  }

  return { filename, services: [...services.values()], networks: [...networks.values()] };
}

export function parsePortBinding(binding) {
  const raw = String(binding).trim();
  const slash = raw.lastIndexOf("/");
  const withoutProtocol = slash >= 0 ? raw.slice(0, slash) : raw;
  const protocol = (slash >= 0 ? raw.slice(slash + 1) : "tcp").toLowerCase();

  if (!withoutProtocol.includes(":")) {
    return { raw, host: null, published: null, containerPort: withoutProtocol, protocol, public: false };
  }

  const containerMatch = withoutProtocol.match(/:([^:]+)$/);
  if (!containerMatch) throw new Error(`Unsupported port binding: ${raw}`);
  const containerPort = containerMatch[1];
  const left = withoutProtocol.slice(0, -(containerPort.length + 1));

  for (const host of LOOPBACK_HOSTS) {
    const prefix = `${host}:`;
    if (left.startsWith(prefix)) {
      return {
        raw,
        host,
        published: left.slice(prefix.length),
        containerPort,
        protocol,
        public: false,
      };
    }
  }

  return { raw, host: null, published: left, containerPort, protocol, public: true };
}

function approvedPublicBinding(serviceName, binding) {
  const rules = APPROVED_PUBLIC[serviceName] ?? [];
  return rules.some((rule) => rule.containerPort === binding.containerPort && rule.protocol === binding.protocol);
}

export function evaluateComposeExposure({ base, overlays = [] }) {
  const failures = [];
  const observations = [];
  const surfaces = [base, ...overlays].filter(Boolean);

  const backend = base?.networks?.find((item) => item.name === "ledgerly_backend");
  if (!backend || backend.internal !== true) failures.push("BASE_BACKEND_NETWORK_NOT_INTERNAL");

  for (const surface of surfaces) {
    for (const network of surface.networks ?? []) {
      if (network.name === "ledgerly_backend" && network.internal === false) {
        failures.push(`${surface.filename}:ledgerly_backend:INTERNAL_DISABLED`);
      }
      if (network.name === "ledgerly_backend" && network.external === true) {
        failures.push(`${surface.filename}:ledgerly_backend:EXTERNAL_NETWORK_FORBIDDEN`);
      }
    }

    for (const service of surface.services ?? []) {
      for (const rawBinding of service.ports ?? []) {
        let binding;
        try {
          binding = parsePortBinding(rawBinding);
        } catch (error) {
          failures.push(`${surface.filename}:${service.name}:UNPARSEABLE_PORT:${rawBinding}`);
          continue;
        }
        observations.push({ filename: surface.filename, service: service.name, ...binding });

        if (PRIVATE_SERVICE_NAMES.has(service.name) && binding.public) {
          failures.push(`${surface.filename}:${service.name}:PRIVATE_PORT_PUBLIC:${binding.raw}`);
          continue;
        }

        if (binding.public && !approvedPublicBinding(service.name, binding)) {
          failures.push(`${surface.filename}:${service.name}:UNAPPROVED_PUBLIC_PORT:${binding.raw}`);
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, observations };
}

export function evaluateCaddySecurity(source) {
  const text = String(source);
  const failures = [];
  if (!/^\s*admin\s+off\s*$/m.test(text)) failures.push("CADDY_ADMIN_NOT_DISABLED");
  if (!/X-Content-Type-Options\s+nosniff/i.test(text)) failures.push("CADDY_NOSNIFF_HEADER_MISSING");
  if (!/X-Frame-Options\s+DENY/i.test(text)) failures.push("CADDY_FRAME_DENY_HEADER_MISSING");
  if (!/Referrer-Policy\s+no-referrer/i.test(text)) failures.push("CADDY_REFERRER_POLICY_MISSING");
  if (!/-Server\b/.test(text)) failures.push("CADDY_SERVER_HEADER_NOT_REMOVED");
  if (/reverse_proxy\s+(postgres|pgbouncer|redis|minio)(?::|\s|$)/i.test(text)) failures.push("CADDY_PRIVATE_SERVICE_PROXY_FORBIDDEN");
  return { ok: failures.length === 0, failures };
}

export async function assessRepositoryExposure({
  root = process.cwd(),
  composeFiles = ["compose.selfhost.yml", "compose.ai.yml", "compose.finance-runtime.yml"],
  caddyFile = "selfhost/caddy/Caddyfile",
} = {}) {
  const loaded = [];
  for (const file of composeFiles) {
    const path = resolve(root, file);
    const source = await readFile(path, "utf8");
    loaded.push(parseComposeSurface(source, { filename: file }));
  }
  const [base, ...overlays] = loaded;
  const compose = evaluateComposeExposure({ base, overlays });
  const caddyPath = resolve(root, caddyFile);
  const caddy = evaluateCaddySecurity(await readFile(caddyPath, "utf8"));
  return { ok: compose.ok && caddy.ok, compose, caddy, composeFiles, caddyFile };
}

export const SECURITY_EXPOSURE_POLICY = Object.freeze({
  privateServices: Object.freeze([...PRIVATE_SERVICE_NAMES]),
  approvedPublic: APPROVED_PUBLIC,
});
