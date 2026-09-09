import type { BackendModuleDefinition } from "../../backend-types";
import { printerlyRoutes } from "./routes";
import { printerlyBatchRoutes } from "./batch-routes";
import { printerlyAuditRoutes } from "./audit-routes";
import { printerlyRoutingRoutes } from "./routing-routes";
import { printerlyReleaseRoutes } from "./release-routes";
import { printerlyRetentionRoutes } from "./retention-routes";
import { printerlyMobileOptionsRoutes } from "./mobile-options-routes";
import { printerlyConsumablesRoutes } from "./consumables-routes";
import { printerlyNodeRoutes } from "./node-routes";
import { runHealthSweep } from "./health";
import { dispatchDueBatches, syncBatchStatuses } from "./batches";
import { rerouteQueuedPoolJobs } from "./routing";
import { cleanupReleaseCredentials } from "./release";
import { runRetentionSweep } from "./retention";
import { runConsumablesSweep } from "./consumables";

export const moduleDefinition: BackendModuleDefinition = {
  key: "printerly", name: "Printerly", version: "1.11.0", order: 42,
  publicRoutes: [{ basePath: "/api/v1/printerly", router: printerlyNodeRoutes }],
  routes: [
    { basePath: "/api/v1/printerly", router: printerlyConsumablesRoutes },
    { basePath: "/api/v1/printerly", router: printerlyRetentionRoutes },
    { basePath: "/api/v1/printerly", router: printerlyMobileOptionsRoutes },
    { basePath: "/api/v1/printerly", router: printerlyReleaseRoutes },
    { basePath: "/api/v1/printerly", router: printerlyRoutingRoutes },
    { basePath: "/api/v1/printerly", router: printerlyAuditRoutes },
    { basePath: "/api/v1/printerly", router: printerlyBatchRoutes },
    { basePath: "/api/v1/printerly", router: printerlyRoutes },
  ],
  scheduled: async (env, controller) => {
    if (!controller || controller.cron === "*/5 * * * *" || controller.cron === "0 * * * *") {
      await Promise.allSettled([runHealthSweep(env), dispatchDueBatches(env), runRetentionSweep(env), runConsumablesSweep(env)]);
      await rerouteQueuedPoolJobs(env.FINANCE_DB);
      await syncBatchStatuses(env.FINANCE_DB);
      if (!controller || controller.cron === "0 * * * *") await cleanupReleaseCredentials(env.FINANCE_DB);
    }
  },
};
