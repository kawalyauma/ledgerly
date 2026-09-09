import type { BackendModuleDefinition } from "../../backend-types";
import { printerlyRoutes } from "./routes";
import { printerlyBatchRoutes } from "./batch-routes";
import { printerlyNodeRoutes } from "./node-routes";
import { runHealthSweep } from "./health";
import { dispatchDueBatches, syncBatchStatuses } from "./batches";

export const moduleDefinition: BackendModuleDefinition = {
  key: "printerly",
  name: "Printerly",
  version: "1.6.0",
  order: 42,
  publicRoutes: [{ basePath: "/api/v1/printerly", router: printerlyNodeRoutes }],
  routes: [
    { basePath: "/api/v1/printerly", router: printerlyBatchRoutes },
    { basePath: "/api/v1/printerly", router: printerlyRoutes },
  ],
  scheduled: async (env, controller) => {
    if (!controller || controller.cron === "*/5 * * * *" || controller.cron === "0 * * * *") {
      await Promise.allSettled([runHealthSweep(env), dispatchDueBatches(env)]);
      await syncBatchStatuses(env.FINANCE_DB);
    }
  },
};
