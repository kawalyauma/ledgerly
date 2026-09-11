# Runtime extensions

Self-hosted domain services that need runtime lifecycle hooks should be added as drop-in `*.extension.mjs` descriptors in this directory instead of rewriting `server/src/runtime.mjs`.

An extension descriptor may provide:

```js
export default {
  name: "example",
  required: false,
  enabled: (config) => true,
  async create({ config, services, auth, createQueue }) {
    return {
      value: {},
      schedulerQueues: { "example.job": createQueue({ name: "example" }) },
      async readiness() { return { ok: true }; },
      describe() { return {}; },
      async close() {},
    };
  },
};
```

Extensions must remain tenant-safe and must not bypass Ledgerly auth, permissions, audit, or business rules.
