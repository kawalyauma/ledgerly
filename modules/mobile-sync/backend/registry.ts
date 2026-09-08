import type { MobileSyncCollectionDefinition } from "./contracts";

const collections = new Map<string, MobileSyncCollectionDefinition>();
const keyOf = (moduleKey: string, collectionKey: string) => `${moduleKey}:${collectionKey}`;

export function registerMobileSyncCollection(definition: MobileSyncCollectionDefinition) {
  const key = keyOf(definition.moduleKey, definition.collectionKey);
  if (collections.has(key)) throw new Error(`Duplicate mobile sync collection: ${key}`);
  if (definition.schemaVersion < 1) throw new Error(`Invalid schema version for ${key}`);
  if (definition.mode !== "read-only" && !definition.prepareMutation) {
    throw new Error(`Writable mobile sync collection ${key} must define prepareMutation()`);
  }
  collections.set(key, Object.freeze({ ...definition }));
  return definition;
}

export function getMobileSyncCollection(moduleKey: string, collectionKey: string) {
  return collections.get(keyOf(moduleKey, collectionKey));
}

export function listMobileSyncCollections() {
  return [...collections.values()].sort((a, b) => keyOf(a.moduleKey, a.collectionKey).localeCompare(keyOf(b.moduleKey, b.collectionKey)));
}
