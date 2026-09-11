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

## Production business routes and cutover authority

`/selfhost/*` routes are compatibility/administration surfaces. A production-shaped route below `/api/v1/*` must explicitly set `business: true`.

`business: true` is not sufficient to make the route reachable. Every business descriptor must also have a reviewed entry in `server/src/runtime/business-route-authority.mjs` that names its cutover capability. Route discovery fails closed when a business descriptor has no mapping, when a mapping references an unknown capability, or when the policy contains a stale/non-business entry.

At registry construction the feature/module `enabled()` check and the central cutover authority check are evaluated independently. A business route is activated only when both are true and its capability state is exactly `node`. `cloudflare` and `shadow` never expose the Node business endpoint.

Current Printerly mappings are:

- `printerly-legacy-node` → `printerly.nodes`;
- `printerly-jobs`, `printerly-documents`, `printerly-approvals` → `printerly.jobs`.

Both Printerly capabilities default to `cloudflare`. Changing a capability to `node` is a cutover decision and must follow migration/integrity/readiness evidence; adding a new `/api/v1/*` route requires updating and testing the authority policy in the same change.

The private `/selfhost/contracts` response includes `httpRouteAuthority`, showing the current capability states and business routes blocked by cutover authority. Do not use that endpoint as a public status surface.
