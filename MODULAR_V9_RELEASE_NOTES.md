# Modular v9 release notes

This release refactors Ledgerly into a modular monolith focused on easy future module additions.

## Main changes

- Added top-level `modules/` architecture.
- Moved the complete School Management backend from `src/plugins/school` into `modules/school/backend`.
- Moved School Management UI code into `modules/school/frontend`.
- Added `modules/ledgerly` as the registration boundary for existing Ledgerly finance/accounting routes and UI.
- Removed the long list of business route mounts from `src/index.ts`; routes are now mounted from the generated backend module registry.
- Removed the hard-coded application route map from `web/App.tsx`.
- Removed hard-coded sidebar business groups from `web/components/AppShell.tsx`.
- Added Vite frontend module auto-discovery from `modules/*/frontend/module.tsx`.
- Added build-time backend module discovery and generated registry/catalog.
- Added `module.json` manifests and automatic synchronization into `app_modules`.
- Added shared `requireModuleEnabled()` middleware for optional organization modules.
- Moved School fee scheduled billing into the School module's scheduled hook.
- Added `npm run module:new -- <key> "<Name>"` scaffolding.
- Added `MODULAR_ARCHITECTURE.md` with module rules and examples.

## Compatibility

No database schema change is required for this refactor. Existing School Management and Finance data remain in the same D1 database. Existing API paths such as `/api/v1/school/...`, `/api/v1/accounts`, `/api/v1/journals`, and other Ledgerly routes are preserved.
