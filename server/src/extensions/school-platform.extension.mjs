import { createSchoolPlatformService } from "../school-platform/service.mjs";

export default {
  name: "school-platform",
  required: false,
  configure(env) {
    return { enabled: env.LEDGERLY_SCHOOL_SELFHOST_ENABLED === "true" };
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
