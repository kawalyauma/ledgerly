# Ledgerly AI Workforce — self-hosted operations

Ledgerly AI Workforce is a local/offline-first employee runtime. The default provider is Ollama, but agent business logic is provider-neutral and runs only through Ledgerly's controlled tool gateway.

## Security boundary

AI employees never receive PostgreSQL credentials, Redis credentials, object-storage credentials, unrestricted SQL, or direct database handles. Models receive only named Ledgerly tools assigned to that employee. Each tool call is checked against:

- the authenticated organization;
- the employee's tool allowlist;
- the employee's configured permissions;
- the current permissions of the human/API actor that authorized the task;
- risk and approval policy;
- durable audit attribution.

Background tasks and handoffs preserve the original authorizing actor. Before execution, Ledgerly resolves that actor's current organization access again. Revoked or reduced access therefore applies to queued and scheduled work as well.

High-risk operations such as payment posting, journal reversal, payroll posting, mark alteration, student deletion and stock adjustment are not exposed as direct autonomous actions. They remain behind restricted tool definitions and human approval policy.

## Runtime

The self-host stack includes an Ollama service. No inference model is hardcoded. Administrators choose models through environment configuration or per-employee settings.

Important environment variables:

```text
LEDGERLY_AI_ENABLED=true
LEDGERLY_AI_PROVIDER=ollama
LEDGERLY_AI_ENDPOINT=http://ollama:11434
LEDGERLY_AI_MODEL=
LEDGERLY_AI_EMBEDDING_MODEL=
LEDGERLY_AI_EMBEDDING_DIMENSIONS=768
LEDGERLY_AI_TIMEOUT_MS=60000
LEDGERLY_AI_CONTEXT_LIMIT=8192
LEDGERLY_AI_MAX_CONCURRENCY=2
LEDGERLY_AI_MAX_RETRIES=2
LEDGERLY_AI_TASK_TIMEOUT_MS=120000
LEDGERLY_AI_MAX_TOOL_CALLS=12
LEDGERLY_AI_MAX_HANDOFFS=3
```

Leaving `LEDGERLY_AI_MODEL` empty is valid. Ledgerly remains healthy while AI Workforce reports a degraded/unconfigured runtime. Install and select a model before assigning inference tasks.

Example model installation on the server:

```bash
docker compose -f compose.selfhost.yml exec ollama ollama pull qwen2.5:7b
```

Then set `LEDGERLY_AI_MODEL=qwen2.5:7b` in `.env.selfhost` and recreate the API service. Choose a model appropriate for the server's RAM/CPU/GPU rather than assuming the example is suitable for every installation.

For semantic retrieval, configure a dedicated embedding model through `LEDGERLY_AI_EMBEDDING_MODEL`. If pgvector or an embedding model is unavailable, knowledge retrieval falls back to PostgreSQL full-text search instead of disabling AI Workforce.

## AI employees

Initial organization templates are:

- Mirembe — Secretary
- Nabirye — Academic Assistant
- Kato — Academic Reviewer
- Amina — Finance Assistant
- Mugisha — HR Assistant
- Nakato — Reception Assistant
- Tendo — Inventory Assistant
- Sanyu — Support Assistant

They are ordinary tenant-owned employee records after seeding. Administrators can customize name, role, department, description, system instructions, provider/model, autonomy level, permissions, allowed tools, knowledge sources, work schedule, approval rules and status.

Autonomy levels are:

1. Adviser — recommendation/draft oriented.
2. Assistant — can execute permitted low-risk tools; consequential work follows approval policy.
3. Autonomous — may execute explicitly allowed non-prohibited actions, still bounded by permissions, tools, approvals and the authorizing human's current access.

## Ledgerly tools

The built-in controlled adapters include tenant-scoped reads for school profile, students, staff, academics, lesson plans, student balances, finance summaries, finance anomalies, unmatched school-fee receipts, inventory summaries, consistency checks and system status.

Adapters use fixed parameterized queries and fail closed with `AI_DOMAIN_NOT_MIGRATED` when a corresponding self-hosted Ledgerly domain has not been migrated yet. Cloudflare remains the fallback platform during staged migration; AI Workforce does not bypass the self-host cutover state by querying D1 directly.

## Knowledge and memory

Uploaded organizational knowledge is stored through tenant-scoped Ledgerly object storage. Text/PDF ingestion, chunking and retrieval are local. Knowledge sources are organization-scoped, and retrieval always includes the authenticated organization constraint.

Employee memory is separate from organizational knowledge. Durable memories can be listed, updated, disabled or cleared per employee. Expired or disabled memories are excluded from normal task context.

## Documents and academic review

AI-generated structured documents preserve AI provenance at document and field level. Later human edits retain the original AI attribution in history. PDF rendering is local and only permitted for approved or published documents.

Academic review records are explicitly labelled `AI REVIEWED`. An AI recommendation never becomes official academic approval; official approval remains a human workflow decision.

## Approvals and audit

Approval requests capture the employee, task, requested action, reason, payload and risk. Approval execution performs permission checks again; an old approval cannot restore permissions that the original actor has since lost.

AI activity is written to the shared durable Ledgerly audit system with AI employee identity, human/API authority where relevant, task/tool identifiers and reason/provenance metadata.

## Health and degraded operation

`GET /selfhost/ai/health` requires `ai:read` and exposes tenant-scoped task metrics. It does not expose task/worker activity belonging to other organizations. The extension's internal readiness probe can use global process health, but an unavailable Ollama runtime degrades AI Workforce rather than making Ledgerly itself unavailable.

Useful states include `ready`, `model_missing`, `offline`, `timeout` and `overloaded`.

## Verification

Server validation commands are:

```bash
cd server
npm run check
npm test
```

Self-host compose validation should also be run from the repository root according to the project's CI workflow. Production rollout should not remove the existing Cloudflare fallback until PostgreSQL migration validation, runtime health, business-domain integrity checks and AI permission/tenant-isolation tests all pass on the target server.
