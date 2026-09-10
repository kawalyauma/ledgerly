export class PostgresDatabase {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
      throw new TypeError("PostgresDatabase requires a pg-compatible pool");
    }
    this.provider = "postgresql-pgbouncer";
    this.pool = pool;
  }

  async health() {
    try {
      const startedAt = Date.now();
      const result = await this.pool.query("SELECT 1 AS ok");
      return {
        ok: result?.rows?.[0]?.ok === 1,
        provider: this.provider,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async query(text, values = []) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new TypeError("query text is required");
    }
    if (!Array.isArray(values)) throw new TypeError("query values must be an array");
    const result = await this.pool.query(text, values);
    return {
      rows: result.rows ?? [],
      rowCount: result.rowCount ?? 0,
      command: result.command ?? null,
    };
  }

  async transaction(work) {
    if (typeof work !== "function") throw new TypeError("transaction requires a callback");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = Object.freeze({
        query: async (text, values = []) => {
          const result = await client.query(text, values);
          return {
            rows: result.rows ?? [],
            rowCount: result.rowCount ?? 0,
            command: result.command ?? null,
          };
        },
      });
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error. The pool will discard an unusable client when released.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (typeof this.pool.end === "function") await this.pool.end();
  }
}

export async function createPostgresDatabase(config) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    application_name: config.applicationName ?? "ledgerly-selfhost-api",
    ssl: config.ssl ? { rejectUnauthorized: config.sslRejectUnauthorized !== false } : false,
  });
  return new PostgresDatabase({ pool });
}
