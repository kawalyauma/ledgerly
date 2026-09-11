# Ledgerly D1 → PostgreSQL migration coverage audit

The self-hosted migration is not complete merely because the registered PostgreSQL phases pass. Every application table created by the Cloudflare D1 migration history must be accounted for before final cutover.

## Run the audit

From `server/`:

```bash
npm run migration:coverage
```

The command scans every top-level `../migrations/*.sql` file for `CREATE TABLE` statements and compares the resulting D1 table inventory with the tables owned by the registered self-hosted migration phases.

The command exits non-zero when either of these conditions is true:

- a D1 source table has no PostgreSQL migration phase and no reviewed exception;
- more than one migration phase claims copy ownership of the same source table.

The JSON report also records:

- source table count;
- registered phase table count;
- intentionally unmigrated tables;
- phase tables not found in the D1 migration history (target-only/renamed projection diagnostics);
- stale or unused exception entries;
- the phase owner for every registered table;
- every scanned SQL file and the tables discovered in it.

## Exception policy

Exceptions live in:

```text
server/src/migration/coverage-allowlist.json
```

The default policy is empty. Do not add a table simply to make the audit green.

Every exception requires:

```json
{
  "table": "example_table",
  "disposition": "transient-derived",
  "reason": "Rebuilt from authoritative retained events after cutover."
}
```

Allowed dispositions are:

- `cloudflare-only` — intentionally remains part of the Cloudflare fallback and is not authoritative self-hosted data;
- `transient-derived` — contains only rebuildable/cache/derived data whose source of truth is migrated elsewhere;
- `obsolete-empty` — legacy table proven unused and empty in the production source.

A reason must be specific enough for a later operator to understand why losing the table is acceptable. The loader rejects duplicate table entries, unknown dispositions and short/empty reasons.

Changing the policy file is a production-data decision and must be reviewed like a migration change. For `obsolete-empty`, capture a production source row-count check in the cutover evidence. For `transient-derived`, document and test the rebuild procedure. For `cloudflare-only`, document the authority/rollback boundary.

`LEDGERLY_MIGRATION_COVERAGE_ALLOWLIST_FILE` may point the CLI at another reviewed manifest during a rehearsal. There is intentionally no normal command-line/environment list of table names that can silently bypass the reviewed policy.

## Interpreting diagnostics

`phaseTablesMissingFromSource` does not fail the audit because a PostgreSQL phase may legitimately contain a target-only table or a renamed/consolidated projection. Each entry must still be reviewed: a typo in a phase manifest can look the same as a legitimate target-only table.

`unusedAllowlistEntries` also does not fail the audit, but stale entries should be deleted. An allowlisted table that later gains a proper migration phase must not leave behind a misleading exception.

## Final cutover requirement

Before production authority moves from Cloudflare to the self-hosted stack:

1. run `npm run migration:coverage` from the exact release commit;
2. require `"ok": true`;
3. review every `intentionallyUnmigratedDetails` entry and its evidence;
4. review `phaseTablesMissingFromSource` and `unusedAllowlistEntries`;
5. archive the JSON report with the migration rehearsal/cutover evidence.

Do not declare migration coverage complete from schema intuition or module names. The generated report is the evidence.
