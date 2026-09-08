import type { BackendModuleDefinition } from "../../backend-types";
import { printerlyRoutes } from "./routes";
import { printerlyNodeRoutes } from "./node-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "printerly",
  name: "Printerly",
  version: "1.1.0",
  order: 42,
  publicRoutes: [{ basePath: "/api/v1/printerly", router: printerlyNodeRoutes }],
  routes: [{ basePath: "/api/v1/printerly", router: printerlyRoutes }],
};
