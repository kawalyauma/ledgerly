import type { BackendModuleDefinition } from "../../backend-types";
import { workPublicRoutes, workRoutes } from "./routes";
import { consumeWorkNotifications, runWorkReminders } from "./notifications";

export const moduleDefinition: BackendModuleDefinition = {
  key: "tasks-work",
  name: "Tasks & Work",
  version: "1.1.0",
  order: 25,
  publicRoutes: [
    { basePath: "/api/v1/work/webhooks", router: workPublicRoutes },
    { basePath: "/api/v1/webhooks", router: workPublicRoutes },
  ],
  routes: [{ basePath: "/api/v1/work", router: workRoutes }],
  queues: {
    "tasks-work-notifications": (batch, env) => consumeWorkNotifications(batch, env),
  },
  scheduled: async (env, controller) => {
    if (!controller || controller.cron === "*/5 * * * *" || controller.cron === "0 5 * * *") await runWorkReminders(env);
  },
};
