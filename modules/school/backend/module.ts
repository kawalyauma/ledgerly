import type { BackendModuleDefinition } from "../../backend-types";
import { schoolRoutes } from "./index";
import { runScheduledFeeBilling } from "./fees/billing";

export const moduleDefinition: BackendModuleDefinition = {
  key: "school-management",
  name: "School Management",
  version: "1.9.0",
  order: 20,
  routes: [
    { basePath: "/api/v1/school", router: schoolRoutes },
  ],
  scheduled: async env => {
    await runScheduledFeeBilling(env.FINANCE_DB);
  },
};
