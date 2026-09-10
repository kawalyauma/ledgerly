import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const META_SUFFIX = ".ledgerly-meta.json";

function normalizeKey(key) {
  if (typeof key !== "string" || key.trim() === "") throw new TypeError("storage key is required");
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Storage key contains an unsafe traversal segment");
  }
  return parts.join("/");
}

async function walk(root, relative = "") {
  const base = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const output = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...(await walk(root, child)));
    else if (!entry.name.endsWith(META_SUFFIX)) output.push(child);
  }
  return output;
}

export class LocalStorage {
  constructor({ root }) {
    if (!root) throw new TypeError("LocalStorage root is required");
    this.provider = "local";
    this.root = path.resolve(root);
  }

  #pathFor(key) {
    const normalized = normalizeKey(key);
    const resolved = path.resolve(this.root, normalized);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Storage key escaped configured root");
    }
    return { normalized, resolved };
  }

  async put(key, bytes, metadata = {}) {
    const { normalized, resolved } = this.#pathFor(key);
    await mkdir(path.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.${randomUUID()}.tmp`;
    const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await writeFile(temporary, payload, { flag: "wx" });
    await rename(temporary, resolved);
    await writeFile(`${resolved}${META_SUFFIX}`, JSON.stringify(metadata), "utf8");
    return { key: normalized, size: payload.byteLength, metadata };
  }

  async get(key) {
    const { resolved } = this.#pathFor(key);
    return readFile(resolved);
  }

  async head(key) {
    const { normalized, resolved } = this.#pathFor(key);
    try {
      const info = await stat(resolved);
      let metadata = {};
      try {
        metadata = JSON.parse(await readFile(`${resolved}${META_SUFFIX}`, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return { key: normalized, size: info.size, modifiedAt: info.mtime.toISOString(), metadata };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key) {
    const { resolved } = this.#pathFor(key);
    await Promise.all([
      rm(resolved, { force: true }),
      rm(`${resolved}${META_SUFFIX}`, { force: true }),
    ]);
    return true;
  }

  async list(prefix = "") {
    const safePrefix = prefix ? normalizeKey(prefix) : "";
    const keys = await walk(this.root);
    return keys.filter((key) => key.startsWith(safePrefix)).sort();
  }

  async createDownloadUrl() {
    throw new Error("LocalStorage download URLs require the authenticated Ledgerly download route, which is not enabled in foundation mode");
  }

  async health() {
    const healthDir = path.join(this.root, ".health");
    await mkdir(healthDir, { recursive: true });
    const probe = path.join(healthDir, `${randomUUID()}.probe`);
    try {
      await writeFile(probe, "ok", { flag: "wx" });
      await readFile(probe, "utf8");
      return { ok: true, provider: this.provider, root: this.root };
    } finally {
      await rm(probe, { force: true });
    }
  }
}
