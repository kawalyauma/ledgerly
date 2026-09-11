# Ledgerly Self-Hosted Parallel Integration Contract

This document defines how the parallel self-hosting streams should integrate without repeatedly colliding in shared files.

## Source of truth

`main` is the integration source of truth.

Every stream must fetch/inspect the latest `main` before a substantial batch. Stream branches own their domain work but do not merge themselves into `main` unless explicitly coordinated.

## Active streams

- `selfhost/school-academics-migration` — School, Students, Staff identity, Academics, Attendance, Books.
- `selfhost/finance-runtime-migration` — Finance, Fees, Payroll, runtime, storage, Printerly, NVR, backups/monitoring/security.
- `selfhost/ai-workforce` — local/offline AI Workforce.
- `selfhost/exams-tasks-migration` — Exams, Tasks & Work, Work Chat.
- `selfhost/communications-shared-migration` — Communications, Contacts, remaining HR, mobile-sync core, shared platform data.

## Migration phase contract

Do not expand a central hard-coded phase object for every domain.

Migration phases are drop-in descriptors under:

```text
server/src/migration/phases/*.phase.mjs
```

A descriptor exports a default object with:

```js
export default {
  name: "domain-name",
  description: "...",
  prerequisites: ["auth-core"],
  tables,
  ensureSchema,
  finalizeSchema: optionalFinalizeFunction,
  relationshipChecks,
};
```

`server/src/migration/phases.mjs` discovers these descriptor files automatically at module load.

Phase names must:

- be lowercase kebab-case;
- be unique;
- not depend on themselves.

The loader fails closed on malformed or duplicate descriptors.

A stream adding a migration phase should normally add its descriptor and domain-specific manifest/schema/validator files without rewriting `phases.mjs`.

## Prerequisites

The runner enforces phase prerequisites against completed migration runs from the same D1 source identity.

Examples:

```text
auth-core
  -> school-reference
      -> student/staff/academic phases
```

Do not bypass prerequisite checks by manually editing migration metadata.

## Runtime extension contract

Domain services that need process lifecycle integration must be added as drop-in descriptors under:

```text
server/src/extensions/*.extension.mjs
```

Do not import every domain directly from `server/src/runtime.mjs`.

A runtime extension may define:

```js
export default {
  name: "domain-name",
  required: false,

  configure(env) {
    return {
      enabled: env.LEDGERLY_DOMAIN_ENABLED !== "false",
    };
  },

  enabled(extensionConfig, coreConfig) {
    return extensionConfig.enabled;
  },

  async create({
    config,
    extensionConfig,
    services,
    auth,
    createQueue,
  }) {
    const queue = createQueue({ name: "domain-jobs" });
    return {
      value: domainService,
      schedulerQueues: {
        "domain.scheduled-job": queue,
      },
      async readiness() { return { ok: true }; },
      describe() { return { provider: "domain" }; },
      async close() {},
    };
  },
};
```

Extension-owned environment parsing belongs in `configure(env)`. The resulting values are available under:

```text
config.extensions[extensionName]
```

This avoids repeatedly editing core `config.mjs` for every module.

An extension may contribute dedicated scheduler queues. The core scheduler routes a job by `job.kind` to the extension queue and falls back to the core queue for unregistered kinds.

Extension readiness is reported separately. Only extensions declared `required: true` may make global readiness fail.

## HTTP route contract

Domain HTTP routes are drop-in descriptors under:

```text
server/src/http/routes/*.route.mjs
```

Do not add every domain route directly to `server/src/index.mjs`.

Example:

```js
export default {
  name: "domain-name",
  prefix: "/selfhost/domain",
  enabled: (config) => config.extensions["domain-name"]?.enabled === true,
  async handle({ request, url, runtime, config, requestId }) {
    return {
      status: 200,
      body: { ok: true },
    };
  },
};
```

One descriptor owns its prefix and all subpaths below it.

Reserved core routes cannot be replaced by a domain descriptor:

- `/selfhost/health`
- `/selfhost/ready`
- `/selfhost/contracts`

Domain handlers must use the shared auth service for authentication, tenant scope and permissions. A route registry is a dispatch mechanism, not an authorization bypass.

The core server retains its security headers and request timeout even when a domain response provides additional headers. Long-running work should enqueue a durable job rather than extending the HTTP timeout.

## Syntax-check contract

`server/package.json` uses:

```bash
npm run check
```

The checker recursively discovers `.mjs` files under:

- `server/src`
- `server/test`
- `server/scripts`

Streams do not need to append every new source file to the package script. This intentionally reduces package-file conflicts.

## Shared files

Treat these as high-conflict integration files:

- `server/package.json`
- `server/src/config.mjs`
- `server/src/runtime.mjs`
- `server/src/index.mjs`
- `.env.selfhost.example`
- `compose.selfhost.yml`
- `docs/SELF_HOSTED_ARCHITECTURE.md`

The phase, runtime-extension and HTTP-route registries exist specifically to reduce edits to these files.

Prefer modular additions over rewriting shared files. When a shared-file change is truly required, fetch the newest `main` immediately before editing and preserve other stream changes.

## Data ownership boundaries

A table/domain should have one primary migration owner.

Shared identities are reused rather than duplicated:

- users and memberships come from auth/core;
- School owns student/guardian/staff school identity;
- Contacts owns shared contact/link metadata, not duplicate person rows;
- Finance reuses staff/student/contact identities;
- Exams reuses school/student/class/subject references;
- AI references Ledgerly entities through tools and stable IDs rather than creating shadow copies.

## Stable IDs

Preserve D1 IDs during migration unless an explicit, documented mapping is required.

Mobile/offline clients, cross-module references, audit trails and imported files depend on stable identifiers.

## Merge readiness

A stream is not integration-ready merely because schema files exist.

Before integration it should have, where applicable:

- migration descriptor(s);
- PostgreSQL target schema;
- transforms;
- prerequisite definition;
- relationship/orphan checks;
- executable tests;
- runtime extension(s) rather than unnecessary core runtime rewrites;
- HTTP route descriptor(s) rather than unnecessary core index rewrites;
- runtime/API compatibility work for owned routes;
- idempotency/concurrency checks for consequential workflows;
- Cloudflare fallback preserved;
- no unexplained cross-tenant behavior;
- documentation of any intentionally deferred work.

## Integration order

Exact order can change based on dependencies, but the default is:

```text
foundation/auth-core
-> school-reference
-> shared mobile/contact foundations where required
-> school people/academics/attendance
-> exams/tasks/communications
-> finance/fees/payroll transactional cutover pieces
-> Printerly/NVR/runtime operations
-> AI Workforce tool integrations
-> final cross-module integration
```

Finance may merge schema/runtime foundations earlier when they do not depend on unfinished school data, but transactional cutover must wait for required identities/references.

## Conflict resolution rule

When two branches modify the same shared file:

1. keep the newest `main` behavior;
2. identify the intent of each stream change;
3. move domain-specific logic into a phase/extension/route descriptor where possible;
4. compose the remaining shared behavior instead of taking one side wholesale;
5. rerun the affected tests;
6. verify Cloudflare fallback is still intact;
7. commit the resolved integration as its own coherent change.

Do not resolve conflicts by blindly choosing `ours` or `theirs` for runtime/config/migration files.

## Final system gates

After all domain branches are integrated, the coordinator still owns:

- complete migration rehearsal;
- row/relationship/domain-integrity comparisons;
- R2/object verification;
- cross-module end-to-end tests;
- mobile/offline tests;
- concurrent finance/attendance tests;
- backup restore drill;
- load testing;
- security review;
- dual-run comparison;
- production cutover;
- controlled retirement of only those Cloudflare resources proven replaced.
