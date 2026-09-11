import { AuthError } from "./errors.mjs";
import { createId, hashPassword, passwordNeedsRehash, randomToken, sha256, verifyPassword } from "./crypto.mjs";
import { decryptMfaSecret, hashRecoveryCode, verifyTotp } from "./mfa.mjs";
import { ALL_SCOPES, hasScope, parseScopes } from "./permissions.mjs";

const DEFAULT_ACCOUNTS = Object.freeze([
  ["1000", "Cash and Bank", "asset", "cash", "debit"],
  ["1100", "Accounts Receivable", "asset", "receivable", "debit"],
  ["1200", "Inventory", "asset", "inventory", "debit"],
  ["2000", "Accounts Payable", "liability", "payable", "credit"],
  ["2100", "Tax Payable", "liability", "tax", "credit"],
  ["2200", "Payroll Payable", "liability", "payroll", "credit"],
  ["3000", "Owner's Equity", "equity", "equity", "credit"],
  ["4000", "Sales Revenue", "revenue", "sales", "credit"],
  ["5000", "Cost of Goods Sold", "expense", "cogs", "debit"],
  ["6000", "Operating Expenses", "expense", "operating", "debit"],
  ["6100", "Payroll Expense", "expense", "payroll", "debit"],
]);

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new AuthError(422, "VALIDATION_ERROR", `${name} is required`);
  return value.trim();
}

function normalizeEmail(value) {
  const email = requireText(value, "email").toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AuthError(422, "VALIDATION_ERROR", "Invalid email");
  return email;
}

export class AuthCompatibilityService {
  constructor({ database, jwt, appSecret, environment = "development", accessTokenTtlSeconds = 900, refreshTtlDays = 30, audit = null }) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") throw new TypeError("AuthCompatibilityService requires database");
    if (!jwt || typeof jwt.signAccessToken !== "function" || typeof jwt.verifyAccessToken !== "function") throw new TypeError("AuthCompatibilityService requires jwt codec");
    if (!appSecret) throw new TypeError("AuthCompatibilityService requires appSecret");
    this.provider = "postgresql-auth-compat";
    this.database = database;
    this.jwt = jwt;
    this.appSecret = appSecret;
    this.environment = environment;
    this.accessTokenTtlSeconds = accessTokenTtlSeconds;
    this.refreshTtlDays = refreshTtlDays;
    this.audit = audit;
  }

  async authenticateRequest({ headers }) {
    if (this.environment === "development") {
      const organizationId = headerValue(headers, "X-Organization-Id");
      const userId = headerValue(headers, "X-User-Id");
      if (organizationId && userId) return { organizationId, userId, role: "owner", scopes: [...ALL_SCOPES] };
    }

    const apiKey = headerValue(headers, "X-API-Key");
    if (apiKey) {
      const hash = sha256(apiKey);
      const result = await this.database.query(
        `SELECT id, organization_id AS "organizationId", scopes
         FROM api_keys
         WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`,
        [hash],
      );
      const key = result.rows[0];
      if (!key) throw new AuthError(401, "INVALID_API_KEY", "API key is invalid or expired");
      await this.database.query("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=$1", [key.id]);
      return { userId: `apikey:${key.id}`, organizationId: key.organizationId, role: "integration", scopes: parseScopes(key.scopes) };
    }

    const authorization = headerValue(headers, "Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new AuthError(401, "UNAUTHENTICATED", "Bearer token required");
    let payload;
    try {
      payload = await this.jwt.verifyAccessToken(authorization.slice(7));
    } catch {
      throw new AuthError(401, "INVALID_TOKEN", "Access token is invalid or expired");
    }
    if (!payload?.sub || typeof payload.org !== "string" || typeof payload.role !== "string") {
      throw new AuthError(401, "INVALID_TOKEN", "Token is missing required claims");
    }
    return {
      userId: payload.sub,
      organizationId: payload.org,
      role: payload.role,
      scopes: parseScopes(payload.scopes),
      ...(typeof payload.mobileDeviceId === "string" ? { mobileDeviceId: payload.mobileDeviceId } : {}),
    };
  }

  requireScope(principal, scope) {
    if (!hasScope(principal, scope)) throw new AuthError(403, "FORBIDDEN", `Missing required scope: ${scope}`);
    return principal;
  }

  async register({ organizationName, baseCurrency = "UGX", name, email, password }) {
    const orgName = requireText(organizationName, "organizationName");
    const displayName = requireText(name, "name");
    const normalizedEmail = normalizeEmail(email);
    if (typeof password !== "string" || password.length < 12 || password.length > 200) throw new AuthError(422, "VALIDATION_ERROR", "Password must be 12-200 characters");
    const currency = String(baseCurrency || "UGX").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new AuthError(422, "VALIDATION_ERROR", "baseCurrency must be a 3-letter code");
    const orgId = createId("org"), userId = createId("usr"), passwordHash = await hashPassword(password);
    await this.database.transaction(async (tx) => {
      const existing = await tx.query("SELECT id FROM users WHERE email=$1", [normalizedEmail]);
      if (existing.rows[0]) throw new AuthError(409, "EMAIL_EXISTS", "Email is already registered");
      await tx.query("INSERT INTO organizations (id,name,base_currency) VALUES ($1,$2,$3)", [orgId, orgName, currency]);
      await tx.query("INSERT INTO users (id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)", [userId, normalizedEmail, displayName, passwordHash]);
      await tx.query("INSERT INTO memberships (organization_id,user_id,role,scopes) VALUES ($1,$2,'owner','[]')", [orgId, userId]);
      for (const [code, accountName, type, subtype, normal] of DEFAULT_ACCOUNTS) {
        await tx.query("INSERT INTO accounts (id,organization_id,code,name,type,subtype,normal_balance) VALUES ($1,$2,$3,$4,$5,$6,$7)", [createId("acc"), orgId, code, accountName, type, subtype, normal]);
      }
    });
    return { organizationId: orgId, userId };
  }

  async #issueTokensWithDb(db, { userId, organizationId, role, scopes, ip = null, userAgent = null, mobileDeviceId = undefined }) {
    const accessToken = await this.jwt.signAccessToken({ userId, organizationId, role, scopes, mobileDeviceId });
    const refreshToken = randomToken(48), sessionId = createId("ses"), refreshHash = sha256(refreshToken);
    await db.query(
      `INSERT INTO sessions (id,user_id,organization_id,refresh_token_hash,expires_at,ip_address,user_agent)
       VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP + ($5 * INTERVAL '1 day'),$6,$7)`,
      [sessionId, userId, organizationId, refreshHash, this.refreshTtlDays, ip, userAgent],
    );
    return { accessToken, expiresIn: this.accessTokenTtlSeconds, refreshToken, sessionId };
  }

  issueTokens(input) {
    return this.#issueTokensWithDb(this.database, input);
  }

  async login({ identifier, email, password, organizationId = null, mfaCode = null, ip = null, userAgent = null }) {
    const rawIdentifier = requireText(identifier || email, "identifier");
    if (typeof password !== "string") throw new AuthError(422, "VALIDATION_ERROR", "Password is required");
    let user;
    if (rawIdentifier.includes("@")) {
      const result = await this.database.query("SELECT id,password_hash AS \"passwordHash\",status FROM users WHERE email=$1", [rawIdentifier.toLowerCase()]);
      user = result.rows[0] ?? null;
    } else {
      if (!organizationId) throw new AuthError(422, "ORGANIZATION_REQUIRED", "Organization is required when signing in with username or phone number");
      const normalized = rawIdentifier.replace(/\s+/g, "").toLowerCase();
      const result = await this.database.query(
        `SELECT u.id,u.password_hash AS "passwordHash",u.status
         FROM school_login_aliases a JOIN users u ON u.id=a.user_id
         WHERE a.organization_id=$1 AND a.alias_normalized=$2 LIMIT 1`,
        [organizationId, normalized],
      );
      user = result.rows[0] ?? null;
    }

    const validPassword = Boolean(user?.passwordHash && user.status === "active" && await verifyPassword(password, user.passwordHash));
    if (!validPassword) {
      if (organizationId) await this.#recordLoginEvent({ organizationId, userId: user?.id ?? null, identifier: rawIdentifier, eventType: "failure", ip, userAgent, reason: "Invalid credentials" }).catch(() => undefined);
      throw new AuthError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    }
    if (passwordNeedsRehash(user.passwordHash)) {
      await this.database.query("UPDATE users SET password_hash=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [await hashPassword(password), user.id]);
    }

    const membershipResult = organizationId
      ? await this.database.query("SELECT organization_id AS \"organizationId\",role,scopes FROM memberships WHERE user_id=$1 AND organization_id=$2 ORDER BY created_at LIMIT 1", [user.id, organizationId])
      : await this.database.query("SELECT organization_id AS \"organizationId\",role,scopes FROM memberships WHERE user_id=$1 ORDER BY created_at LIMIT 1", [user.id]);
    const membership = membershipResult.rows[0];
    if (!membership) throw new AuthError(403, "NO_MEMBERSHIP", "No organization membership found");

    const profile = (await this.database.query(
      `SELECT status, locked_until AS "lockedUntil"
       FROM school_user_profiles WHERE organization_id=$1 AND user_id=$2`,
      [membership.organizationId, user.id],
    )).rows[0] ?? null;
    if (profile && (profile.status === "suspended" || profile.status === "inactive" || (profile.status === "locked" && (!profile.lockedUntil || new Date(profile.lockedUntil) > new Date())))) {
      throw new AuthError(403, "ACCOUNT_LOCKED", "School account is suspended or locked");
    }

    const mfa = (await this.database.query(
      `SELECT secret_encrypted AS "secretEncrypted", recovery_code_hashes_json AS "recoveryHashes"
       FROM school_user_mfa WHERE organization_id=$1 AND user_id=$2 AND method='totp' AND enabled=true`,
      [membership.organizationId, user.id],
    )).rows[0] ?? null;
    if (mfa) {
      if (!mfaCode) throw new AuthError(401, "MFA_REQUIRED", "Two-factor authentication code required", { method: "totp" });
      const secret = await decryptMfaSecret(this.appSecret, mfa.secretEncrypted);
      let valid = await verifyTotp(secret, mfaCode);
      if (!valid) {
        const recoveryHash = hashRecoveryCode(mfaCode);
        const hashes = parseScopes(mfa.recoveryHashes);
        const index = hashes.indexOf(recoveryHash);
        if (index >= 0) {
          valid = true;
          hashes.splice(index, 1);
          await this.database.query(
            "UPDATE school_user_mfa SET recovery_code_hashes_json=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND user_id=$3 AND method='totp'",
            [JSON.stringify(hashes), membership.organizationId, user.id],
          );
        }
      }
      if (!valid) throw new AuthError(401, "INVALID_MFA_CODE", "Two-factor authentication code is invalid");
    }

    await this.database.query("UPDATE school_user_profiles SET failed_login_count=0,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND user_id=$2", [membership.organizationId, user.id]);
    await this.#recordLoginEvent({ organizationId: membership.organizationId, userId: user.id, identifier: rawIdentifier, eventType: "success", ip, userAgent }).catch(() => undefined);
    return this.issueTokens({ userId: user.id, organizationId: membership.organizationId, role: membership.role, scopes: parseScopes(membership.scopes), ip, userAgent });
  }

  async refresh({ refreshToken, ip = null, userAgent = null }) {
    if (!refreshToken) throw new AuthError(422, "REFRESH_TOKEN_REQUIRED", "Refresh token required");
    const hash = sha256(refreshToken);
    return this.database.transaction(async (tx) => {
      const result = await tx.query(
        `SELECT s.id,s.user_id AS "userId",s.organization_id AS "organizationId",m.role,m.scopes
         FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.organization_id=s.organization_id
         WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
         FOR UPDATE OF s`,
        [hash],
      );
      const session = result.rows[0];
      if (!session) throw new AuthError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
      await tx.query("UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1", [session.id]);
      return this.#issueTokensWithDb(tx, { userId: session.userId, organizationId: session.organizationId, role: session.role, scopes: parseScopes(session.scopes), ip, userAgent });
    });
  }

  async logout({ refreshToken }) {
    if (refreshToken) await this.database.query("UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE refresh_token_hash=$1 AND revoked_at IS NULL", [sha256(refreshToken)]);
  }

  async getOrganizationAccess(principal) {
    const result = await this.database.query(
      `SELECT o.id,o.name,o.legal_name AS "legalName",o.base_currency AS "baseCurrency",o.timezone,o.status,
              m.role,m.scopes
       FROM organizations o JOIN memberships m ON m.organization_id=o.id
       WHERE o.id=$1 AND m.user_id=$2`,
      [principal.organizationId, principal.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AuthError(403, "NO_MEMBERSHIP", "No organization membership found");
    return { ...row, scopes: parseScopes(row.scopes) };
  }

  async health() {
    const required = ["organizations", "users", "memberships", "sessions", "api_keys", "school_login_aliases", "school_user_profiles", "school_user_mfa", "school_login_events"];
    const result = await this.database.query(
      `SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS name`,
      [required],
    );
    const missing = result.rows.filter((row) => !row.present).map((row) => row.name);
    return { ok: missing.length === 0, provider: this.provider, schemaReady: missing.length === 0, missingTables: missing };
  }

  describe() {
    return { provider: this.provider, passwordFormat: "scrypt-v1", legacyPasswordFormat: "pbkdf2-sha256", accessTokenAlgorithm: "HS256", accessTokenTtlSeconds: this.accessTokenTtlSeconds, refreshTtlDays: this.refreshTtlDays, ownerAdminScopeBypass: true };
  }

  async #recordLoginEvent({ organizationId, userId, identifier, eventType, ip, userAgent, reason = null }) {
    await this.database.query(
      `INSERT INTO school_login_events (id,organization_id,user_id,identifier,event_type,ip_address,user_agent,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [createId("sle"), organizationId, userId, identifier, eventType, ip, userAgent, reason],
    );
  }
}
