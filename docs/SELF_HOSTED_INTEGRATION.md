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

Prefer modular additions over rewriting them. When a shared-file change is required, fetch the newest `main` immediately before editing and preserve other stream changes.

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
3. compose the behaviors instead of taking one side wholesale;
4. rerun the affected tests;
5. verify Cloudflare fallback is still intact;
6. commit the resolved integration as its own coherent change.

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
