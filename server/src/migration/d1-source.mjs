function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

export function safeIdentifier(value, name = "identifier") {
  const text = requireText(value, name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) throw new TypeError(`${name} contains unsupported characters`);
  return `"${text}"`;
}

function normalizeD1Response(payload) {
  if (!payload || payload.success === false) {
    const message = payload?.errors?.map((item) => item?.message).filter(Boolean).join("; ") || "D1 query failed";
    throw new Error(message);
  }
  const first = Array.isArray(payload.result) ? payload.result[0] : payload.result;
  if (!first || first.success === false) {
    const message = first?.error || first?.errors?.map((item) => item?.message).filter(Boolean).join("; ") || "D1 query failed";
    throw new Error(message);
  }
  return {
    rows: Array.isArray(first.results) ? first.results : [],
    meta: first.meta ?? {},
  };
}

export class D1HttpSource {
  constructor({ accountId, databaseId, apiToken, apiBaseUrl = "https://api.cloudflare.com/client/v4", timeoutMs = 15000, fetchImpl = fetch }) {
    this.accountId = requireText(accountId, "Cloudflare account ID");
    this.databaseId = requireText(databaseId, "D1 database ID");
    this.apiToken = requireText(apiToken, "Cloudflare API token");
    this.apiBaseUrl = requireText(apiBaseUrl, "Cloudflare API base URL").replace(/\/$/, "");
    this.timeoutMs = Number(timeoutMs) || 15000;
    this.fetchImpl = fetchImpl;
  }

  async query(sql, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.apiBaseUrl}/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql, params }),
          signal: controller.signal,
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.errors?.map((item) => item?.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
        throw new Error(`Cloudflare D1 query failed: ${detail}`);
      }
      return normalizeD1Response(payload);
    } finally {
      clearTimeout(timer);
    }
  }

  async tableExists(table) {
    const result = await this.query("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [requireText(table, "table")]);
    return result.rows.length > 0;
  }

  async count(table) {
    const result = await this.query(`SELECT COUNT(*) AS count FROM ${safeIdentifier(table, "table")}`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async batch(table, { columns, afterRowid = 0, limit = 500 }) {
    const names = columns.map((column) => safeIdentifier(column, "column")).join(", ");
    const result = await this.query(
      `SELECT rowid AS __ledgerly_rowid, ${names} FROM ${safeIdentifier(table, "table")} WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`,
      [afterRowid, limit],
    );
    return result.rows;
  }
}
