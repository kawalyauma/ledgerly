import { createSchoolPlatformService } from "../school-platform/service.mjs";

function cutover(value, fallback="cloudflare") {
  const mode=String(value??fallback).trim().toLowerCase();
  if(!["cloudflare","shadow","node"].includes(mode)) throw new Error(`Invalid school cutover mode: ${value}`);
  return mode;
}

export default {
  name: "school-platform",
  required: false,
  configure(env) {
    const fallback=cutover(env.LEDGERLY_SCHOOL_CUTOVER,"cloudflare");
    return {
      enabled: env.LEDGERLY_SCHOOL_SELFHOST_ENABLED === "true",
      setupCutover: cutover(env.LEDGERLY_SCHOOL_SETUP_CUTOVER,fallback),
    };
  },
  enabled(extensionConfig) {
    return extensionConfig.enabled === true;
  },
  async create({ services }) {
    const service = createSchoolPlatformService({ database: services.database });
    return {
      value: service,
      readiness: () => service.readiness(),
      describe: () => service.describe(),
    };
  },
};
