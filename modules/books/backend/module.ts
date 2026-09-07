import type { BackendModuleDefinition } from "../../backend-types";
import { bookRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "books",
  name: "Books",
  version: "1.0.0",
  order: 35,
  routes: [{ basePath: "/api/v1/books", router: bookRoutes }],
};
