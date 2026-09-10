function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

function asIso(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

export class PostgresScheduler {
  constructor({ database, nextRun }) {
    if (!database || typeof database.query !== "function") {
      throw new TypeError("PostgresScheduler requires the Ledgerly database service");
    }
    if (typeof nextRun !== "function") throw new TypeError("PostgresScheduler requires a cron next-run calculator");
    this.provider = "postgresql-scheduler";
    this.database = database;
    this.nextRunCalculator = nextRun;
  }

  async ensureSchema() {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_meta.schedules (
        id text PRIMARY KEY,
        name text NOT NULL,
        organization_id text NOT NULL,
        kind text NOT NULL,
        cron_expression text NOT NULL,
        timezone text NOT NULL DEFAULT 'UTC',
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        concurrency_policy text NOT NULL DEFAULT 'forbid'
          CHECK (concurrency_policy IN ('forbid', 'allow')),
        next_run_at timestamptz NOT NULL,
        last_run_at timestamptz,
        locked_at timestamptz,
        locked_by text,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.database.query(`
      CREATE INDEX IF NOT EXISTS schedules_due_idx
      ON ledgerly_meta.schedules (enabled, next_run_at)
    `);
    await this.database.query(`
      CREATE INDEX IF NOT EXISTS schedules_org_idx
      ON ledgerly_meta.schedules (organization_id, enabled, next_run_at)
    `);
  }

  nextRun(cronExpression, timezone = "UTC", currentDate = new Date()) {
    const value = this.nextRunCalculator(requireText(cronExpression, "cron"), requireText(timezone, "timezone"), currentDate);
    return value instanceof Date ? value : new Date(value);
  }

  async register({
    id,
    name,
    organizationId,
    kind,
    cron,
    timezone = "UTC",
    payload = {},
    enabled = true,
    concurrencyPolicy = "forbid",
    currentDate = new Date(),
  }) {
    if (!["forbid", "allow"].includes(concurrencyPolicy)) {
      throw new TypeError("concurrencyPolicy must be forbid or allow");
    }
    const nextRunAt = this.nextRun(cron, timezone, currentDate);
    if (Number.isNaN(nextRunAt.getTime())) throw new Error("Cron expression did not produce a valid next run");

    const result = await this.database.query(
      `INSERT INTO ledgerly_meta.schedules (
        id, name, organization_id, kind, cron_expression, timezone, payload,
        enabled, concurrency_policy, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        organization_id = EXCLUDED.organization_id,
        kind = EXCLUDED.kind,
        cron_expression = EXCLUDED.cron_expression,
        timezone = EXCLUDED.timezone,
        payload = EXCLUDED.payload,
        enabled = EXCLUDED.enabled,
        concurrency_policy = EXCLUDED.concurrency_policy,
        next_run_at = EXCLUDED.next_run_at,
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        updated_at = now()
      RETURNING *`,
      [
        requireText(id, "schedule id"),
        requireText(name, "schedule name"),
        requireText(organizationId, "organizationId"),
        requireText(kind, "kind"),
        requireText(cron, "cron"),
        requireText(timezone, "timezone"),
        JSON.stringify(payload ?? {}),
        Boolean(enabled),
        concurrencyPolicy,
        nextRunAt.toISOString(),
      ],
    );
    return result.rows[0];
  }

  async cancel(id) {
    const result = await this.database.query(
      `UPDATE ledgerly_meta.schedules
       SET enabled = false, locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE id = $1
       RETURNING id, enabled`,
      [requireText(id, "schedule id")],
    );
    return result.rows[0] ?? null;
  }

  async list({ organizationId = null, enabled = null, limit = 100 } = {}) {
    const clauses = [];
    const values = [];
    if (organizationId != null) {
      values.push(organizationId);
      clauses.push(`organization_id = $${values.length}`);
    }
    if (enabled != null) {
      values.push(Boolean(enabled));
      clauses.push(`enabled = $${values.length}`);
    }
    values.push(Math.max(1, Math.min(Number(limit) || 100, 500)));
    const result = await this.database.query(
      `SELECT * FROM ledgerly_meta.schedules
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY next_run_at ASC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  }

  async claimDue({ workerId, now = new Date(), limit = 20, staleAfterMs = 300000 } = {}) {
    const normalizedWorker = requireText(workerId, "workerId");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError("limit must be between 1 and 500");
    if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1000) throw new TypeError("staleAfterMs must be at least 1000");
    const nowIso = asIso(now, "now");
    const staleBefore = new Date(new Date(nowIso).getTime() - staleAfterMs).toISOString();

    const result = await this.database.query(
      `WITH due AS (
        SELECT id
        FROM ledgerly_meta.schedules
        WHERE enabled = true
          AND next_run_at <= $1::timestamptz
          AND (locked_at IS NULL OR locked_at < $2::timestamptz)
        ORDER BY next_run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      )
      UPDATE ledgerly_meta.schedules AS schedule
      SET locked_at = $1::timestamptz,
          locked_by = $4,
          updated_at = now()
      FROM due
      WHERE schedule.id = due.id
      RETURNING schedule.*`,
      [nowIso, staleBefore, limit, normalizedWorker],
    );
    return result.rows;
  }

  async markDispatched(id, { workerId, dispatchedAt = new Date(), nextRunAt }) {
    const result = await this.database.query(
      `UPDATE ledgerly_meta.schedules
       SET last_run_at = $3::timestamptz,
           next_run_at = $4::timestamptz,
           locked_at = NULL,
           locked_by = NULL,
           last_error = NULL,
           updated_at = now()
       WHERE id = $1 AND locked_by = $2
       RETURNING *`,
      [
        requireText(id, "schedule id"),
        requireText(workerId, "workerId"),
        asIso(dispatchedAt, "dispatchedAt"),
        asIso(nextRunAt, "nextRunAt"),
      ],
    );
    return result.rows[0] ?? null;
  }

  async releaseClaim(id, { workerId, error = null } = {}) {
    const result = await this.database.query(
      `UPDATE ledgerly_meta.schedules
       SET locked_at = NULL,
           locked_by = NULL,
           last_error = $3,
           updated_at = now()
       WHERE id = $1 AND locked_by = $2
       RETURNING *`,
      [
        requireText(id, "schedule id"),
        requireText(workerId, "workerId"),
        error == null ? null : String(error).slice(0, 4000),
      ],
    );
    return result.rows[0] ?? null;
  }

  async health() {
    try {
      const result = await this.database.query(
        `SELECT count(*)::int AS enabled_count
         FROM ledgerly_meta.schedules
         WHERE enabled = true`,
      );
      return {
        ok: true,
        provider: this.provider,
        durable: true,
        enabledSchedules: Number(result.rows[0]?.enabled_count ?? 0),
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider,
        durable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export async function createPostgresScheduler({ database }) {
  const { CronExpressionParser } = await import("cron-parser");
  const nextRun = (cronExpression, timezone, currentDate) => {
    const expression = CronExpressionParser.parse(cronExpression, {
      currentDate: currentDate instanceof Date ? currentDate : new Date(currentDate),
      tz: timezone,
    });
    return expression.next().toDate();
  };
  const scheduler = new PostgresScheduler({ database, nextRun });
  await scheduler.ensureSchema();
  return scheduler;
}
