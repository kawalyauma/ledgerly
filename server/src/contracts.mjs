import { randomUUID } from "node:crypto";

export const ACTOR_TYPES = Object.freeze(["human", "ai_agent", "system", "integration"]);
export const SERVICE_CONTRACT_VERSION = 3;

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function segment(value) {
  return encodeURIComponent(requireText(String(value), "key segment"));
}

export function tenantCacheKey(organizationId, ...parts) {
  const org = segment(organizationId);
  const tail = parts.flat().map(segment).join(":");
  return `ledgerly:v1:org:${org}${tail ? `:${tail}` : ""}`;
}

export function tenantStorageKey(organizationId, logicalKey) {
  const org = segment(organizationId);
  const raw = requireText(logicalKey, "logicalKey").replaceAll("\\", "/");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Storage keys may not contain traversal segments");
  }
  return `org/${org}/${parts.map(segment).join("/")}`;
}

export function createJobEnvelope({
  kind,
  organizationId,
  payload = {},
  idempotencyKey = null,
  jobId = randomUUID(),
  createdAt = new Date().toISOString(),
  attempt = 0,
}) {
  if (!Number.isInteger(attempt) || attempt < 0) throw new TypeError("attempt must be a non-negative integer");
  return Object.freeze({
    jobId: requireText(jobId, "jobId"),
    kind: requireText(kind, "kind"),
    organizationId: requireText(organizationId, "organizationId"),
    createdAt: requireText(createdAt, "createdAt"),
    attempt,
    idempotencyKey: idempotencyKey == null ? null : requireText(idempotencyKey, "idempotencyKey"),
    payload,
  });
}

const REQUIRED_METHODS = Object.freeze({
  database: ["health", "query", "transaction"],
  cache: ["get", "set", "delete", "remember", "invalidateTag", "health"],
  storage: ["put", "get", "head", "delete", "list", "createDownloadUrl", "health"],
  queue: ["enqueue", "take", "ack", "retry", "deadLetter", "size", "deadLetterSize", "health"],
  scheduler: ["register", "cancel", "list", "claimDue", "markDispatched", "releaseClaim", "nextRun", "health"],
  events: ["publish", "subscribe", "health"],
  notifications: ["send", "health"],
  audit: ["write", "list", "health"],
});

export function assertServiceContracts(services) {
  for (const [name, methods] of Object.entries(REQUIRED_METHODS)) {
    const service = services?.[name];
    if (!service) throw new Error(`Missing runtime service: ${name}`);
    for (const method of methods) {
      if (typeof service[method] !== "function") {
        throw new Error(`Runtime service ${name} must implement ${method}()`);
      }
    }
  }
  return services;
}
