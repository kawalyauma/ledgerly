# Self-hosted HTTP routes

Domain HTTP APIs should be added as `*.route.mjs` descriptors in this directory instead of modifying `server/src/index.mjs`.

Example:

```js
export default {
  name: "example",
  prefix: "/selfhost/example",
  enabled: (config) => true,
  async handle({ request, url, runtime, config, requestId }) {
    return { status: 200, body: { ok: true } };
  },
};
```

A route owns its prefix and all subpaths beneath it. Authentication, tenant scoping and permission checks remain the route/domain service's responsibility and must use the shared auth/runtime services.
