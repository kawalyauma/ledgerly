function readPort(value, fallback, name) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return parsed;
}

function readPositiveInt(value, fallback, name) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeInt(value, fallback, name) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function readBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(value).toLowerCase())) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function readCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const environment = env.LEDGERLY_ENVIRONMENT ?? "development";
  const runtimeMode = env.LEDGERLY_RUNTIME_MODE ?? "foundation";

  if (!["foundation", "production"].includes(runtimeMode)) {
    throw new Error("LEDGERLY_RUNTIME_MODE must be foundation or production");
  }

  const dependencyTimeoutMs = readPositiveInt(
    env.LEDGERLY_DEPENDENCY_TIMEOUT_MS,
    1500,
    "LEDGERLY_DEPENDENCY_TIMEOUT_MS",
  );

  return Object.freeze({
    serviceName: "ledgerly-selfhost-api",
    environment,
    runtimeMode,
    host: env.LEDGERLY_API_HOST ?? "0.0.0.0",
    port: readPort(env.LEDGERLY_API_PORT, 8788, "LEDGERLY_API_PORT"),
    dependencyTimeoutMs,
    database: Object.freeze({
      host: env.LEDGERLY_DATABASE_HOST ?? "127.0.0.1",
      port: readPort(env.LEDGERLY_DATABASE_PORT, 6432, "LEDGERLY_DATABASE_PORT"),
      database: env.LEDGERLY_DATABASE_NAME ?? "ledgerly",
      user: env.LEDGERLY_DATABASE_USER ?? "ledgerly",
      password: env.LEDGERLY_DATABASE_PASSWORD ?? "",
      poolMax: readPositiveInt(env.LEDGERLY_DATABASE_POOL_MAX, 20, "LEDGERLY_DATABASE_POOL_MAX"),
      connectionTimeoutMs: dependencyTimeoutMs,
      idleTimeoutMs: readPositiveInt(env.LEDGERLY_DATABASE_IDLE_TIMEOUT_MS, 30000, "LEDGERLY_DATABASE_IDLE_TIMEOUT_MS"),
      ssl: readBoolean(env.LEDGERLY_DATABASE_SSL, false),
      sslRejectUnauthorized: readBoolean(env.LEDGERLY_DATABASE_SSL_REJECT_UNAUTHORIZED, true),
      applicationName: "ledgerly-selfhost-api",
    }),
    redis: Object.freeze({
      host: env.LEDGERLY_REDIS_HOST ?? "127.0.0.1",
      port: readPort(env.LEDGERLY_REDIS_PORT, 6379, "LEDGERLY_REDIS_PORT"),
      password: env.LEDGERLY_REDIS_PASSWORD ?? "",
      database: readNonNegativeInt(env.LEDGERLY_REDIS_DATABASE, 0, "LEDGERLY_REDIS_DATABASE"),
      connectTimeoutMs: dependencyTimeoutMs,
      namespace: env.LEDGERLY_REDIS_NAMESPACE ?? "ledgerly:selfhost",
    }),
    queue: Object.freeze({
      name: env.LEDGERLY_QUEUE_NAME ?? "core",
      maxAttempts: readPositiveInt(env.LEDGERLY_QUEUE_MAX_ATTEMPTS, 5, "LEDGERLY_QUEUE_MAX_ATTEMPTS"),
    }),
    scheduler: Object.freeze({
      enabled: readBoolean(env.LEDGERLY_SCHEDULER_ENABLED, true),
      pollIntervalMs: readPositiveInt(env.LEDGERLY_SCHEDULER_POLL_INTERVAL_MS, 5000, "LEDGERLY_SCHEDULER_POLL_INTERVAL_MS"),
      claimLimit: readPositiveInt(env.LEDGERLY_SCHEDULER_CLAIM_LIMIT, 20, "LEDGERLY_SCHEDULER_CLAIM_LIMIT"),
      lockTimeoutMs: readPositiveInt(env.LEDGERLY_SCHEDULER_LOCK_TIMEOUT_MS, 300000, "LEDGERLY_SCHEDULER_LOCK_TIMEOUT_MS"),
      workerId: env.LEDGERLY_SCHEDULER_WORKER_ID || null,
    }),
    notifications: Object.freeze({
      timeoutMs: readPositiveInt(env.LEDGERLY_NOTIFICATION_TIMEOUT_MS, 10000, "LEDGERLY_NOTIFICATION_TIMEOUT_MS"),
      requiredChannels: Object.freeze(readCsv(env.LEDGERLY_NOTIFICATION_REQUIRED_CHANNELS)),
      sms: Object.freeze({
        apiUrl: env.EGOSMS_API_URL || "https://www.egosms.co/api/v1/plain/",
        username: env.EGOSMS_USERNAME || "",
        password: env.EGOSMS_PASSWORD || "",
        senderId: env.EGOSMS_SENDER_ID || "",
      }),
      whatsapp: Object.freeze({
        hubUrl: env.WHATSAPP_SUPPORT_HUB_URL || "",
        appKey: env.WHATSAPP_SUPPORT_APP_KEY || "",
        templateName: env.LEDGERLY_WHATSAPP_TEMPLATE || "general_app_update",
        language: env.LEDGERLY_WHATSAPP_LANGUAGE || "en_US",
      }),
      email: Object.freeze({
        apiUrl: env.RESEND_API_URL || "https://api.resend.com/emails",
        apiKey: env.RESEND_API_KEY || "",
        fromEmail: env.RESEND_FROM_EMAIL || "",
      }),
    }),
    objectStorage: Object.freeze({
      host: env.LEDGERLY_OBJECT_STORAGE_HOST ?? "127.0.0.1",
      port: readPort(env.LEDGERLY_OBJECT_STORAGE_PORT, 9000, "LEDGERLY_OBJECT_STORAGE_PORT"),
      useSSL: readBoolean(env.LEDGERLY_OBJECT_STORAGE_SSL, false),
      accessKey: env.LEDGERLY_OBJECT_STORAGE_ACCESS_KEY ?? "ledgerly",
      secretKey: env.LEDGERLY_OBJECT_STORAGE_SECRET_KEY ?? "",
      bucket: env.LEDGERLY_OBJECT_STORAGE_BUCKET ?? "ledgerly",
      region: env.LEDGERLY_OBJECT_STORAGE_REGION ?? "us-east-1",
      createBucket: readBoolean(env.LEDGERLY_OBJECT_STORAGE_CREATE_BUCKET, true),
      publicBaseUrl: env.LEDGERLY_OBJECT_STORAGE_PUBLIC_BASE_URL ?? null,
    }),
    storage: Object.freeze({
      root: env.LEDGERLY_STORAGE_PATH ?? "/var/lib/ledgerly/storage",
    }),
  });
}
