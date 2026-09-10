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

export function loadConfig(env = process.env) {
  const environment = env.LEDGERLY_ENVIRONMENT ?? "development";
  const runtimeMode = env.LEDGERLY_RUNTIME_MODE ?? "foundation";

  if (!["foundation", "production"].includes(runtimeMode)) {
    throw new Error("LEDGERLY_RUNTIME_MODE must be foundation or production");
  }

  return Object.freeze({
    serviceName: "ledgerly-selfhost-api",
    environment,
    runtimeMode,
    host: env.LEDGERLY_API_HOST ?? "0.0.0.0",
    port: readPort(env.LEDGERLY_API_PORT, 8788, "LEDGERLY_API_PORT"),
    dependencyTimeoutMs: readPositiveInt(
      env.LEDGERLY_DEPENDENCY_TIMEOUT_MS,
      1500,
      "LEDGERLY_DEPENDENCY_TIMEOUT_MS",
    ),
    database: Object.freeze({
      host: env.LEDGERLY_DATABASE_HOST ?? "127.0.0.1",
      port: readPort(env.LEDGERLY_DATABASE_PORT, 6432, "LEDGERLY_DATABASE_PORT"),
    }),
    redis: Object.freeze({
      host: env.LEDGERLY_REDIS_HOST ?? "127.0.0.1",
      port: readPort(env.LEDGERLY_REDIS_PORT, 6379, "LEDGERLY_REDIS_PORT"),
    }),
    objectStorage: Object.freeze({
      host: env.LEDGERLY_OBJECT_STORAGE_HOST ?? "127.0.0.1",
      port: readPort(env.LEDGERLY_OBJECT_STORAGE_PORT, 9000, "LEDGERLY_OBJECT_STORAGE_PORT"),
    }),
    storage: Object.freeze({
      root: env.LEDGERLY_STORAGE_PATH ?? "/var/lib/ledgerly/storage",
    }),
  });
}
