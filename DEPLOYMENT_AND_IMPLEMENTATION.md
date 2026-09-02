# Deployment and Implementation Guide

This guide describes how to develop, verify, and deploy **Your Finance Pro**. The application consists of a React/Vite frontend and a Cloudflare Worker API built with Hono, D1, R2, and Queues.

## 1. Architecture

| Layer | Technology | Location |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite | `web/` |
| API | Hono on Cloudflare Workers | `src/index.ts` |
| Database | Cloudflare D1 with Drizzle schema | `src/db/schema.ts`, `migrations/` |
| Object storage | Cloudflare R2 | `REPORTS_BUCKET` |
| Background jobs | Cloudflare Queues | `REPORT_QUEUE`, `WEBHOOK_QUEUE` |
| Scheduled work | Worker cron trigger | hourly |

Public API routes are `/auth/*`, `/system/*`, `/docs`, and `/openapi.json`. Authenticated business APIs use `/api/v1/*`.

The frontend is a hash-routed single-page application. Authentication state and refresh handling live in `web/api.ts` and `web/auth.tsx`. Route and scope rules are defined in `web/App.tsx`, while scope-filtered navigation is defined in `web/components/AppShell.tsx`.

## 2. Prerequisites

- Node.js 20 or newer
- npm
- A Cloudflare account with Workers, D1, R2, and Queues enabled
- Wrangler authenticated with `npx wrangler login`

Install dependencies:

```bash
npm ci
```

## 3. Environment configuration

The Worker expects these bindings and variables:

| Name | Type | Purpose |
| --- | --- | --- |
| `FINANCE_DB` | D1 | Accounting and application data |
| `REPORTS_BUCKET` | R2 | Generated report files |
| `REPORT_QUEUE` | Queue | Asynchronous report jobs |
| `WEBHOOK_QUEUE` | Queue | Webhook deliveries |
| `ENVIRONMENT` | Variable | `development`, `staging`, or `production` |
| `JWT_SECRET` | Secret | JWT signing key; use at least 32 random bytes |
| `JWT_ISSUER` | Variable | Expected token issuer |
| `JWT_AUDIENCE` | Variable | Expected token audience |

For local work, create `.dev.vars` without committing it:

```dotenv
JWT_SECRET=replace-with-a-long-random-development-secret
```

Generate a suitable secret with:

```bash
openssl rand -base64 48
```

Never place production secrets in `wrangler.jsonc`, source files, frontend environment variables, or Git.

## 4. Local development

Apply the D1 migrations:

```bash
npm run db:migrate:local
```

Run the API:

```bash
npm run dev
```

In another terminal, run the frontend:

```bash
npm run dev:web
```

The frontend runs at `http://localhost:5173` and the Worker normally runs at `http://localhost:8787`.

### Required local proxy configuration

Vite must proxy all same-origin backend paths. The current `vite.config.ts` proxies `/api` and `/system`; add `/auth`, `/docs`, and `/openapi.json` when those paths need to work through port 5173:

```ts
server: {
  port: 5173,
  proxy: {
    "/api": "http://localhost:8787",
    "/auth": "http://localhost:8787",
    "/system": "http://localhost:8787",
    "/docs": "http://localhost:8787",
    "/openapi.json": "http://localhost:8787",
  },
}
```

Without the `/auth` proxy, registration, login, refresh, and logout requests from the Vite development server will not reach the Worker.

### Development bootstrap

The bootstrap route works only when `ENVIRONMENT=development`:

```bash
curl -X POST http://localhost:8787/system/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationName": "Example Ltd",
    "legalName": "Example Limited",
    "baseCurrency": "UGX",
    "ownerEmail": "owner@example.com",
    "ownerName": "Example Owner"
  }'
```

Normal frontend testing should use `/auth/register` and `/auth/login`. Development identity headers are a backend-testing convenience and are disabled outside development.

## 5. Implemented frontend modules

### Authentication and access

- Owner registration and login
- Remembered or session-only authentication
- Access-token refresh with authorized-request retry
- Backend refresh-session revocation on logout
- Session restoration and expired-session handling
- Role/scope-filtered navigation and protected routes
- Owner, administrator, accountant, manager, viewer, and integration roles

### Organization and administration

- Active-organization selector and token-scoped switching
- Organization profile, currency, timezone, fiscal year, tax, and numbering settings
- Initial setup checklist
- Team-member listing and creation
- Role permission presets and read/write dependencies
- Backend support for member role/scope updates and member removal
- API-key creation, one-time secret display/download, filtering, and revocation
- Backend health view

### Accounting and finance

- Chart of accounts, account editing, activation, deletion, and merging
- Account groups and backend group update/deletion validation
- Dimensions and opening balances
- Journals, contacts, products, sales, purchasing, approvals, receivables, and payments
- Banking, reconciliation, inventory, expenses, projects, and recurring transactions
- Tax, payroll, budgets, closing, reports, dashboards, documents, compliance, and webhooks

## 6. Permission model

Owners and administrators bypass explicit scope checks. Other roles require assigned scopes such as:

```text
accounts:read       accounts:write
journals:read       journals:write
reports:read        reports:write
contacts:read       contacts:write
products:read       products:write
documents:read      documents:write
payments:read       payments:write
payroll:read        payroll:write
periods:read        periods:write
admin:read          admin:write
```

Frontend checks improve usability, but the Worker remains the authorization boundary. Every protected backend operation must continue using `requireScope` and organization-scoped database queries.

## 7. Verification before deployment

Run the complete existing verification suite:

```bash
npm run typecheck
npm test
npm run build:web
```

Also verify these workflows manually in a staging environment:

1. Register an owner and confirm default accounts exist.
2. Log in, refresh the page, and verify session restoration.
3. Switch organizations and confirm tenant data changes.
4. Verify a viewer cannot see or call write actions.
5. Add and update a member with restricted scopes.
6. Create an API key, save its secret, and revoke it.
7. Create, edit, deactivate, merge, and delete eligible accounts.
8. Submit a balanced opening journal and retry with the same idempotency key.
9. Confirm posted financial records cannot be destructively edited.
10. Confirm `/system/health`, queue processing, report downloads, and webhook delivery.

## 8. Create Cloudflare resources

Create resources once per environment:

```bash
npx wrangler d1 create your-finance-pro
npx wrangler r2 bucket create your-finance-pro-reports
npx wrangler queues create finance-report-jobs
npx wrangler queues create finance-report-jobs-dlq
npx wrangler queues create finance-webhook-jobs
npx wrangler queues create finance-webhook-jobs-dlq
```

Copy the generated D1 database ID into the relevant environment configuration in `wrangler.jsonc`. Ensure every queue and bucket name matches the resource created in that Cloudflare account.

Set the production secret:

```bash
npx wrangler secret put JWT_SECRET
```

Set `ENVIRONMENT` to `production` for production deployment. Use separate databases, buckets, queues, secrets, and hostnames for staging and production.

## 9. Frontend hosting decision

The current Worker configuration deploys the API but does **not** declare `dist/` as a static asset directory. Choose one of these deployment models before going live.

### Option A: Worker with static assets

Build the frontend and configure Cloudflare Worker static assets so `dist/` is served for application routes, while `/api/*`, `/auth/*`, `/system/*`, `/docs`, and `/openapi.json` execute the Worker first. This keeps frontend and API on one origin and matches the current frontend request client.

Do not route `/` to the API JSON response when using this model; `/` should serve `dist/index.html`. Configure SPA fallback so hash/deep navigation returns the frontend entry point.

### Option B: Separate frontend deployment

Deploy `dist/` to Cloudflare Pages or another static host and deploy the Worker independently. This requires:

- An environment-driven API base URL in `web/api.ts`
- Production CORS origins in `src/index.ts`
- Credentials and token policy appropriate for cross-origin requests
- All PDF/download links updated to use the API origin

The repository currently assumes same-origin API requests, so Option A requires fewer application changes.

## 10. Production deployment

After selecting and configuring the hosting model:

```bash
npm ci
npm run typecheck
npm test
npm run build:web
npm run db:migrate:remote
npm run deploy
```

Apply migrations before deploying code that relies on the new schema. For higher-risk migrations, deploy backward-compatible schema changes first, then code, then cleanup migrations in a later release.

Post-deployment smoke checks:

```bash
curl -fsS https://YOUR_DOMAIN/system/health
curl -fsS https://YOUR_DOMAIN/openapi.json > /dev/null
curl -I https://YOUR_DOMAIN/
```

Then test registration/login or a staging account, organization switching, one read operation, one reversible write operation, a queued report, and logout.

## 11. Rollback and recovery

- Keep the previously deployed Worker version available for rollback.
- Use Cloudflare deployment rollback for application regressions.
- Do not reverse a database migration by deleting production data.
- Prefer forward-fix migrations and restore testing against a copy first.
- Enable D1 recovery/Time Travel according to the production plan.
- Retain generated financial exports and audit evidence according to applicable policy.
- Document queue replay procedures and ensure idempotency keys prevent duplicate financial writes.

## 12. Remaining implementation work

Before declaring the frontend fully complete against the original specification:

- Add member edit/remove dialogs using the implemented backend endpoints.
- Add full account-group edit, hierarchy, activation, and deletion controls.
- Complete dimension editing, activation, filters, and a reusable dimension selector.
- Derive setup checklist status from backend data instead of static values.
- Report real R2 and queue health rather than “Not reported.”
- Add unsaved-change navigation guards and session-expiry warnings.
- Add a global toast system, frontend error boundary, and not-found page.
- Replace remaining browser `alert`, `confirm`, and `prompt` interactions with accessible dialogs.
- Preserve opening-balance idempotency keys across retry/reload and tighten line validation.
- Add frontend component, authorization, and end-to-end browser tests.
- Add code splitting for the large set of finance workspaces.

## 13. Production security checklist

- [ ] `ENVIRONMENT=production`
- [ ] Strong Cloudflare-managed `JWT_SECRET`
- [ ] No development identity headers accepted
- [ ] Exact production CORS allowlist
- [ ] Cloudflare WAF and rate limits configured
- [ ] Separate staging and production resources
- [ ] D1 recovery and backup procedures tested
- [ ] R2 retention and access policy configured
- [ ] Queue dead-letter monitoring configured
- [ ] Logs exclude passwords, refresh tokens, API-key secrets, and sensitive bank data
- [ ] Tenant-isolation and authorization tests passed
- [ ] Financial idempotency and period-lock tests passed
- [ ] Tax and payroll behavior reviewed for each supported jurisdiction
- [ ] Incident response and rollback ownership documented

This software provides accounting infrastructure and does not replace professional tax, audit, payroll, or legal advice.
