import type { BackendModuleDefinition } from "../../backend-types";
import { contactsRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "contacts",
  name: "Contacts",
  version: "1.0.0",
  order: 15,
  routes: [{ basePath: "/api/v1/contacts", router: contactsRoutes }],
};
