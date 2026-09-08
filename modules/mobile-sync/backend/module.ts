import type { BackendModuleDefinition } from "../../backend-types";
import { mobileSyncRoutes } from "./routes";
import { mobileSyncPublicRoutes } from "./public-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "mobile-sync",
  name: "Mobile Sync Core",
  version: "1.0.0",
  order: 12,
  publicRoutes: [{ basePath: "/api/v1/mobile-sync/offline", router: mobileSyncPublicRoutes }],
  routes: [{ basePath: "/api/v1/mobile-sync", router: mobileSyncRoutes }],
};
