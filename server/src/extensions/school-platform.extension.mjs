import { createSchoolPlatformService } from "../school-platform/service.mjs";
import { createSchoolSetupService } from "../school-platform/setup-service.mjs";

function cutover(value, fallback = "cloudflare") {
  const mode = String(value ?? fallback).trim().toLowerCase();
  if (!["cloudflare", "shadow", "node"].includes(mode)) {
    throw new Error(`Invalid school cutover mode: ${value}`);
  }
  return mode;
}

export default {
  name: "school-platform",
  required: false,
  configure(env) {
    return {
      enabled: env.LEDGERLY_SCHOOL_SELFHOST_ENABLED === "true",
      referenceReadCutover: cutover(env.LEDGERLY_SCHOOL_REFERENCE_READ_CUTOVER),
      referenceWriteCutover: cutover(env.LEDGERLY_SCHOOL_REFERENCE_WRITE_CUTOVER),
      peopleReadCutover: cutover(env.LEDGERLY_SCHOOL_PEOPLE_READ_CUTOVER),
      peopleWriteCutover: cutover(env.LEDGERLY_SCHOOL_PEOPLE_WRITE_CUTOVER),
      filesCutover: cutover(env.LEDGERLY_SCHOOL_FILES_CUTOVER),
    };
  },
  enabled(extensionConfig) {
    return extensionConfig.enabled === true;
  },
  async create({ services }) {
    const service = createSchoolPlatformService({ database: services.database });
    service.setup = createSchoolSetupService({ database: services.database });
    return {
      value: service,
      readiness: () => service.readiness(),
      describe: () => ({
        ...service.describe(),
        setupProvider: service.setup.provider,
      }),
    };
  },
};
