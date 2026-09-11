import { readdir } from "node:fs/promises";

const DIRECTORY = new URL("./collections/", import.meta.url);
const SUFFIX = ".collection.mjs";

function normalize(definition, sourceFile) {
  if (!definition || typeof definition !== "object") throw new TypeError(`Sync collection ${sourceFile} must export an object`);
  const moduleKey = String(definition.moduleKey ?? "").trim();
  const collectionKey = String(definition.collectionKey ?? "").trim();
  if (!moduleKey || !collectionKey) throw new TypeError(`Sync collection ${sourceFile} requires moduleKey and collectionKey`);
  if (typeof definition.canRead !== "function") throw new TypeError(`Sync collection ${moduleKey}:${collectionKey} requires canRead()`);
  if (definition.apply != null && typeof definition.apply !== "function") throw new TypeError(`Sync collection ${moduleKey}:${collectionKey} apply must be a function`);
  return Object.freeze({ ...definition, moduleKey, collectionKey, sourceFile });
}

export async function loadMobileSyncCollections() {
  let entries;
  try {
    entries = await readdir(DIRECTORY);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const definitions = [];
  const keys = new Set();
  for (const entry of entries.filter((name) => name.endsWith(SUFFIX)).sort()) {
    const module = await import(new URL(`./collections/${entry}`, import.meta.url));
    const definition = normalize(module.default ?? module.collection, entry);
    const key = `${definition.moduleKey}:${definition.collectionKey}`;
    if (keys.has(key)) throw new Error(`Duplicate mobile sync collection: ${key}`);
    keys.add(key);
    definitions.push(definition);
  }
  return definitions;
}
