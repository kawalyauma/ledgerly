import { readdir } from "node:fs/promises";

const EXTENSION_DIRECTORY = new URL("./extensions/", import.meta.url);
const EXTENSION_SUFFIX = ".extension.mjs";

function normalizeDescriptor(descriptor, sourceFile) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError(`Runtime extension ${sourceFile} must export an object`);
  }
  const name = String(descriptor.name ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Runtime extension ${sourceFile} has an invalid name`);
  }
  if (typeof descriptor.create !== "function") {
    throw new TypeError(`Runtime extension ${name} must define create()`);
  }
  if (descriptor.enabled != null && typeof descriptor.enabled !== "function") {
    throw new TypeError(`Runtime extension ${name} enabled must be a function`);
  }
  return Object.freeze({
    name,
    required: descriptor.required === true,
    enabled: descriptor.enabled ?? (() => true),
    create: descriptor.create,
    sourceFile,
  });
}

async function discoverDescriptors() {
  const entries = (await readdir(EXTENSION_DIRECTORY))
    .filter((name) => name.endsWith(EXTENSION_SUFFIX))
    .sort((a, b) => a.localeCompare(b));
  const descriptors = [];
  const names = new Set();
  for (const entry of entries) {
    const module = await import(new URL(`./extensions/${entry}`, import.meta.url));
    const descriptor = normalizeDescriptor(module.default ?? module.extension, entry);
    if (names.has(descriptor.name)) throw new Error(`Duplicate runtime extension name: ${descriptor.name}`);
    names.add(descriptor.name);
    descriptors.push(descriptor);
  }
  return descriptors;
}

const DESCRIPTORS = await discoverDescriptors();

function normalizeInstance(descriptor, instance) {
  if (!instance || typeof instance !== "object") {
    throw new TypeError(`Runtime extension ${descriptor.name} create() must return an object`);
  }
  const schedulerQueues = instance.schedulerQueues ?? {};
  if (!schedulerQueues || typeof schedulerQueues !== "object" || Array.isArray(schedulerQueues)) {
    throw new TypeError(`Runtime extension ${descriptor.name} schedulerQueues must be an object`);
  }
  for (const [kind, queue] of Object.entries(schedulerQueues)) {
    if (!kind.trim() || typeof queue?.enqueue !== "function") {
      throw new TypeError(`Runtime extension ${descriptor.name} has an invalid scheduler queue route: ${kind}`);
    }
  }
  return Object.freeze({
    name: descriptor.name,
    required: descriptor.required,
    value: instance.value ?? instance,
    readiness: typeof instance.readiness === "function" ? instance.readiness.bind(instance) : async () => ({ ok: true }),
    describe: typeof instance.describe === "function" ? instance.describe.bind(instance) : () => ({}),
    close: typeof instance.close === "function" ? instance.close.bind(instance) : async () => undefined,
    schedulerQueues: Object.freeze({ ...schedulerQueues }),
  });
}

export function listRuntimeExtensionDescriptors() {
  return DESCRIPTORS.map(({ name, required, sourceFile }) => ({ name, required, sourceFile }));
}

export async function createRuntimeExtensions(context) {
  const instances = [];
  const schedulerQueues = {};
  try {
    for (const descriptor of DESCRIPTORS) {
      if (!await descriptor.enabled(context.config)) continue;
      const instance = normalizeInstance(descriptor, await descriptor.create(context));
      for (const [kind, queue] of Object.entries(instance.schedulerQueues)) {
        if (schedulerQueues[kind]) throw new Error(`Duplicate scheduler queue route for job kind: ${kind}`);
        schedulerQueues[kind] = queue;
      }
      instances.push(instance);
    }
  } catch (error) {
    await Promise.allSettled(instances.toReversed().map((instance) => instance.close()));
    throw error;
  }

  const values = Object.freeze(Object.fromEntries(instances.map((instance) => [instance.name, instance.value])));

  return Object.freeze({
    values,
    schedulerQueues: Object.freeze({ ...schedulerQueues }),
    async readiness() {
      const results = {};
      let ok = true;
      for (const instance of instances) {
        try {
          const result = await instance.readiness();
          results[instance.name] = { required: instance.required, ...result };
          if (instance.required && result?.ok !== true) ok = false;
        } catch (error) {
          results[instance.name] = {
            ok: false,
            required: instance.required,
            error: error instanceof Error ? error.message : String(error),
          };
          if (instance.required) ok = false;
        }
      }
      return { ok, items: results };
    },
    describe() {
      return Object.fromEntries(instances.map((instance) => [instance.name, {
        required: instance.required,
        ...instance.describe(),
      }]));
    },
    async close() {
      const settled = await Promise.allSettled(instances.toReversed().map((instance) => instance.close()));
      const failure = settled.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    },
  });
}
