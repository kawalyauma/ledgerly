import type { BackendModuleDefinition } from "../../backend-types";
import { printerlyRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "printerly",
  name: "Printerly",
  version: "1.0.0",
  order: 42,
  routes: [{ basePath: "/api/v1/printerly", router: printerlyRoutes }],
};
