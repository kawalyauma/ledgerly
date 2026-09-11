import { tenantStorageKey, tenantStoragePrefix } from "../contracts.mjs";

function requireStorage(storage) {
  const methods = ["put", "get", "head", "delete", "list", "createDownloadUrl", "health"];
  if (!storage) throw new TypeError("Tenant storage requires a backing storage service");
  for (const method of methods) {
    if (typeof storage[method] !== "function") throw new TypeError(`Backing storage must implement ${method}()`);
  }
  return storage;
}

function requireOrganizationId(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("organizationId is required");
  return value.trim();
}

function decodeLogicalKey(prefix, physicalKey) {
  if (typeof physicalKey !== "string" || !physicalKey.startsWith(prefix)) {
    throw new Error("Backing storage returned a key outside the tenant prefix");
  }
  return physicalKey
    .slice(prefix.length)
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
    .join("/");
}

export class TenantScopedStorage {
  constructor({ storage, organizationId }) {
    this.storage = requireStorage(storage);
    this.organizationId = requireOrganizationId(organizationId);
    this.prefix = tenantStoragePrefix(this.organizationId);
    this.provider = `${storage.provider ?? "storage"}:tenant-scoped`;
  }

  physicalKey(logicalKey) {
    return tenantStorageKey(this.organizationId, logicalKey);
  }

  async put(logicalKey, bytes, metadata = {}) {
    const result = await this.storage.put(this.physicalKey(logicalKey), bytes, metadata);
    return {
      ...result,
      key: decodeLogicalKey(this.prefix, result?.key ?? this.physicalKey(logicalKey)),
      tenantScoped: true,
    };
  }

  get(logicalKey) {
    return this.storage.get(this.physicalKey(logicalKey));
  }

  async head(logicalKey) {
    const result = await this.storage.head(this.physicalKey(logicalKey));
    if (!result) return null;
    return {
      ...result,
      key: decodeLogicalKey(this.prefix, result.key ?? this.physicalKey(logicalKey)),
      tenantScoped: true,
    };
  }

  delete(logicalKey) {
    return this.storage.delete(this.physicalKey(logicalKey));
  }

  async list(logicalPrefix = "") {
    const physicalPrefix = logicalPrefix ? this.physicalKey(logicalPrefix) : this.prefix;
    const keys = await this.storage.list(physicalPrefix);
    return keys.map((key) => decodeLogicalKey(this.prefix, key)).sort();
  }

  createDownloadUrl(logicalKey, options = {}) {
    return this.storage.createDownloadUrl(this.physicalKey(logicalKey), options);
  }

  async health() {
    const result = await this.storage.health();
    return {
      ...result,
      tenantScoped: true,
    };
  }
}

export function createTenantStorageFactory(storage) {
  requireStorage(storage);
  const cache = new Map();
  return Object.freeze({
    provider: "tenant-storage-factory",
    forOrganization(organizationId) {
      const id = requireOrganizationId(organizationId);
      if (!cache.has(id)) cache.set(id, new TenantScopedStorage({ storage, organizationId: id }));
      return cache.get(id);
    },
  });
}
