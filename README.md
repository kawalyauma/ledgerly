# Your Finance Pro API

A Cloudflare-native, multi-tenant accounting backend built with TypeScript, Hono, D1, Queues and R2.

## Implemented foundation

- Tenant-scoped organizations, users, memberships and granular API scopes
- Configurable chart of accounts
- Double-entry journals with integer minor-unit money, exchange rates and dimensions
- Idempotent financial writes
- Draft and immutable posted journal lifecycle
- Contacts, invoices/bills, document lines, products, inventory, projects and budgets
- Customer and supplier APIs, product/service APIs and tenant-safe account validation
- Draft invoices, bills, credit notes and supplier credits with calculated line totals
- Invoice/bill posting with automatic AR/AP, revenue/expense and tax journal lines
- Customer receipts and supplier payments with partial allocation and over-allocation protection
- Automatic paid/partially-paid document states and allocation-backed ageing reports
- Non-overlapping fiscal periods with soft-close and lock enforcement on every posting workflow
- Owner/admin-controlled reopening of locked periods with mandatory audit reasons
- Equal-and-opposite journal, document and payment reversals without deleting posted history
- Allocation reversal triggers that restore invoice and bill outstanding balances atomically
- Safe deletion of drafts; posted transactions must be reversed
- Classes, departments and locations
- Audit history
- Synchronous JSON reports and asynchronous JSON/CSV exports to R2
- Profit and loss, balance sheet, cash flow, trial balance, general ledger and transaction detail
- Receivables/payables ageing, sales/expense analysis, inventory valuation and stock status
- Project profitability, budget versus actual, tax and payroll summaries
- JWT authorization, development bootstrap, OpenAPI document and interactive API reference
- Queue retries, dead-letter queue configuration and idempotent report-job claiming
- Multi-organization company profiles, address/tax/numbering settings and organization switching at login
- Account hierarchy, account groups, opening-balance imports, account merging and full dimension management
- Tax jurisdictions, inclusive/exclusive and withholding codes, exemptions, return preparation, locking and filing
- Bank statement imports, transaction matching, reconciliation, transfers, charges and cheque tracking
- Rich customer/supplier records with addresses, people, credit controls, pricing tiers and encrypted supplier bank details
- Sales orders, delivery notes, purchase requisitions, goods receipts, recurring transactions and maker-checker approvals
- Document PDFs, attachments, delivery/open tracking and employee expense claims
- Automatic inventory/COGS integration, reservations, lots/serials/expiry, stock counts and reorder advice
- Customer statements, dunning actions, fees, write-offs, refunds, deposits and payment plans

## Prerequisites

- Node.js 20 or newer
- A Cloudflare account
- Wrangler authenticated with `npx wrangler login`

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Bootstrap a development organization:

```bash
curl -X POST http://localhost:8787/system/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"organizationName":"Example Ltd","baseCurrency":"UGX","ownerEmail":"owner@example.com","ownerName":"Example Owner"}'
```

Use the returned IDs as `X-Organization-Id` and `X-User-Id` headers during local development. Production never accepts these headers and requires a signed JWT.

## Create Cloudflare resources

```bash
npx wrangler d1 create your-finance-pro
npx wrangler r2 bucket create your-finance-pro-reports
npx wrangler queues create finance-report-jobs
npx wrangler queues create finance-report-jobs-dlq
```

Copy the D1 database ID into `wrangler.jsonc`, then configure the production secret:

```bash
npx wrangler secret put JWT_SECRET
npm run db:migrate:remote
npm run deploy
```

Use a randomly generated secret of at least 32 bytes. Set `ENVIRONMENT` to `production` before deployment.

## API conventions

- Base URL: `/api/v1`
- Interactive reference: `/docs`
- OpenAPI document: `/openapi.json`
- Health endpoint: `/system/health`
- Money: signed integer minor units (`1250` means UGX 1,250 for UGX and USD 12.50 for USD)
- Quantities: integer micro-units (`1500000` means 1.5)
- Exchange rates: integer micro-rates (`1250000` means 1.25)
- Financial `POST` requests require an `Idempotency-Key`
- Dates use ISO `YYYY-MM-DD`; timestamps use UTC ISO 8601

## Example journal

```bash
curl -X POST http://localhost:8787/api/v1/journals \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: opening-balance-001' \
  -H 'X-Organization-Id: org_xxx' \
  -H 'X-User-Id: usr_xxx' \
  -d '{
    "transactionDate":"2026-08-30",
    "postingDate":"2026-08-30",
    "description":"Opening capital",
    "currency":"UGX",
    "lines":[
      {"accountId":"acc_cash","debitMinor":1000000},
      {"accountId":"acc_equity","creditMinor":1000000}
    ]
  }'
```

## Production controls

Before handling real financial data:

1. Replace the development bootstrap with the selected identity provider and token issuer.
2. Configure strict CORS origins and Cloudflare WAF/rate-limit rules.
3. Enable D1 Time Travel and schedule encrypted exports to a separate account or jurisdiction.
4. Add maker-checker approval policies and fiscal-period locks.
5. Validate tax and payroll rules with qualified professionals in every supported jurisdiction.
6. Run load, penetration, tenant-isolation and disaster-recovery tests.

This software provides accounting infrastructure; it is not itself tax, audit or legal advice.

## Modular architecture (v0.2.0 / modular v9)

Major capabilities now live under the top-level `modules/` directory. To scaffold a future module without editing the central Worker/router/sidebar files:

```bash
npm run module:new -- library "Library Management"
```

See `MODULAR_ARCHITECTURE.md` for the full module contract, database ownership rules, and deployment workflow.
