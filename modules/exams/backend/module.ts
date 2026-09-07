import type { BackendModuleDefinition } from "../../backend-types";
import { examRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "exams",
  name: "Examinations",
  version: "1.0.0",
  order: 30,
  routes: [{ basePath: "/api/v1/exams", router: examRoutes }],
};
