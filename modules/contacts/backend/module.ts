import "./mobile-sync";
import type { BackendModuleDefinition } from "../../backend-types";
import { contactsRoutes } from "./routes";
import { contactsManagementRoutes } from "./management-workflow";

export const moduleDefinition: BackendModuleDefinition = {
  key: "contacts",
  name: "Contacts",
  version: "1.1.0",
  order: 15,
  routes: [
    { basePath: "/api/v1/contacts", router: contactsRoutes },
    { basePath: "/api/v1/contacts", router: contactsManagementRoutes },
  ],
};
