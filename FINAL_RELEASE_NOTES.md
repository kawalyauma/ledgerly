# Ledgerly final v6 source release

Validation performed before packaging:
- 15 SQL migrations applied successfully to a clean SQLite database.
- 168 database tables created by the complete migration chain.
- 88 TypeScript/TSX files parsed with zero syntax errors.
- Product/service creation includes accounting-account selectors.
- Sales, purchasing, and payment reference fields use record selectors rather than raw IDs where supported by the current API.
- School Management includes the nested Fees & Billing navigation introduced in v5.

A complete `npm run typecheck` and Vite production build require `npm install` because dependencies are intentionally not bundled in this source archive.

The archive intentionally excludes `.dev.vars`, `.wrangler`, `node_modules`, `dist`, local databases, and Git metadata.
