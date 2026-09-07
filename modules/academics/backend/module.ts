import type { BackendModuleDefinition } from "../../backend-types";
import { academicsRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "academics",
  name: "Academics",
  version: "1.0.0",
  order: 25,
  routes: [{ basePath: "/api/v1/academics", router: academicsRoutes }],
};
