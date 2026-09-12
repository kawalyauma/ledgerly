import { createPlatformModulesService } from "../platform-modules/service.mjs";

function cutover(value) {
  const mode = String(value ?? "cloudflare").trim().toLowerCase();
  if (!["cloudflare", "shadow", "node"].includes(mode)) throw new Error("LEDGERLY_PLATFORM_MODULES_CUTOVER must be cloudflare, shadow, or node");
  return mode;
}

export default {
  name: "platform-modules",
  required: false,
  configure(env) {
    return {
      enabled: env.LEDGERLY_PLATFORM_MODULES_SELFHOST_ENABLED === "true",
      cutover: cutover(env.LEDGERLY_PLATFORM_MODULES_CUTOVER),
    };
  },
  enabled(extensionConfig) {
    return extensionConfig.enabled === true;
  },
  async create({ services, extensionConfig }) {
    const service = createPlatformModulesService({ database: services.database, audit: services.audit });
    return {
      value: service,
      readiness: () => service.readiness(),
      describe: () => ({ ...service.describe(), cutover: extensionConfig.cutover }),
    };
  },
};
