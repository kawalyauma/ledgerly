# Ledgerly modular architecture

Ledgerly v0.2.0 is a **modular monolith**. The application is still built and deployed as one Cloudflare Worker + one Vite frontend, but major business capabilities live in isolated top-level module folders.

This is intentionally simpler than runtime plugins. Adding a module changes the source tree, then the normal build/deploy publishes the new combined application.

## The important rule

**New major features belong in `modules/<module-name>/`, not in `src/index.ts`, `web/App.tsx`, or `web/components/AppShell.tsx`.**

A normal module looks like:

```text
modules/library/
├── module.json
├── backend/
│   ├── index.ts
│   └── module.ts
└── frontend/
    ├── ModulePage.tsx
    └── module.tsx
```

Existing application modules are:

```text
modules/
├── contacts/   # shared, standalone people directory driven by enabled modules
├── human-resources/ # workforce and leave records linked to enabled people sources
├── ledgerly/   # accounting/finance/core Ledgerly application routes + UI registration
├── payroll-payments/ # payroll processing and organization payments
└── school/     # School Management backend and frontend implementation
```

The Contacts module owns the shared contact API and UI. Its `/contacts/capabilities`
and `/contacts/people` endpoints resolve organization module enablement at request
time, so finance relationships, school people, work users, and messaging readiness
only appear when their contributing module is enabled.

## Create a new module

Use the generator:

```bash
npm run module:new -- library "Library Management"
```

That creates and registers `modules/library/` with a backend API entry and frontend UI entry. You can then implement the module without editing the application shell.

Examples:

```bash
npm run module:new -- attendance "Attendance"
npm run module:new -- exams "Examinations"
npm run module:new -- transport "Transport"
npm run module:new -- hostel "Boarding & Hostel"
```

## How automatic registration works

### Backend

Every module with:

```text
modules/<name>/backend/module.ts
```

exports a `moduleDefinition`. Before `dev`, `typecheck`, `test`, `build:web`, and `deploy`, `scripts/sync-modules.mjs` scans the `modules` directory and regenerates:

```text
modules/backend-registry.generated.ts
modules/catalog.generated.ts
```

`src/index.ts` mounts all backend routes from that generated registry. Therefore a future module does **not** add imports or `app.route(...)` statements to `src/index.ts`.

### Frontend

`modules/frontend-registry.ts` uses Vite's build-time module discovery:

```text
modules/*/frontend/module.tsx
```

Routes and navigation are combined automatically. A future module does **not** edit `web/App.tsx` or `web/components/AppShell.tsx`.

### Module catalog

Every module has `module.json`. The `/api/v1/modules` API synchronizes these code manifests into `app_modules`. New code modules therefore appear in Apps & Modules after deployment without requiring a separate migration just to register their name/version.

An optional module can use:

```ts
routes.use("*", requireModuleEnabled("library"));
```

so its API is available only for organizations where it is enabled.

## Shared database

All modules continue to use the same `FINANCE_DB` D1 binding. Keep table ownership clear with prefixes:

```text
core_*   shared/core records
fin_*    finance-owned records
school_* school core records
att_*    attendance-owned records
exm_*    examinations-owned records
lib_*    library-owned records
pay_*    payroll-owned records
trn_*    transport-owned records
```

A module may reference shared IDs such as student, organization, user, academic year, term, class, or account IDs. Avoid directly rewriting another module's business tables unless that integration is explicitly part of the shared service contract.

Database schema migrations still use the repository's standard top-level `migrations/` directory so Wrangler/D1 migration history remains globally ordered.

## Backend module contract

A module backend exports:

```ts
import type { BackendModuleDefinition } from "../../backend-types";
import { routes } from "./index";

export const moduleDefinition: BackendModuleDefinition = {
  key: "library",
  name: "Library Management",
  version: "1.0.0",
  order: 200,
  routes: [
    { basePath: "/api/v1/library", router: routes },
  ],
};
```

A module can optionally add scheduled work:

```ts
scheduled: async env => {
  // module CRON work
}
```

The main Worker automatically executes module scheduled hooks.

## Frontend module contract

A module frontend exports a default definition:

```tsx
const moduleDefinition = {
  key: "library",
  name: "Library Management",
  version: "1.0.0",
  order: 200,
  routes: {
    library: { scope: "library:read", view: LibraryPage },
  },
  navigation: [
    {
      label: "Library",
      icon: BookOpen,
      order: 200,
      items: [
        { label: "Library", path: "library", scope: "library:read" },
      ],
    },
  ],
};

export default moduleDefinition;
```

## Deployment workflow

Adding a module does not require a special plugin deployment system:

```text
Create module folder
       ↓
Implement backend/frontend
       ↓
Add any required D1 migration
       ↓
npm run typecheck
npm test
npm run build:web
       ↓
npm run deploy
```

The npm lifecycle runs `modules:sync` before the relevant commands.

## What remains core

The following concerns should remain shared rather than duplicated inside modules:

- authentication and sessions
- organizations/tenants
- users and memberships
- permissions/scopes
- D1 binding and transaction conventions
- audit logging
- IDs and common errors
- shared accounting services
- shared file/storage infrastructure
- application shell and authentication UI

## Current School Management organization

School Management is now physically self-contained under:

```text
modules/school/
├── module.json
├── backend/
│   ├── setup.ts
│   ├── iam.ts
│   ├── students.ts
│   ├── staff.ts
│   ├── files.ts
│   ├── mfa.ts
│   └── fees/
└── frontend/
    ├── SchoolManagementPages.tsx
    ├── SchoolStaffPages.tsx
    └── SchoolFeesPages.tsx
```

It still shares Ledgerly authentication, users, organizations, D1, accounting, payments, journals, documents and audit services. The refactor changes code organization, not the financial integration.

## Design target

Future growth should look like:

```text
modules/
├── contacts/
├── ledgerly/
├── school/
├── attendance/
├── exams/
├── library/
├── transport/
├── payroll-advanced/
└── communications/
```

The number of modules can grow without turning `src/index.ts`, `web/App.tsx`, or the sidebar into giant registration files.
