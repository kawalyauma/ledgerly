import { ContactRound } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { ContactsPage } from "./ContactsPage";
import "./contacts.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "contacts",
  name: "Contacts",
  version: "1.0.0",
  order: 15,
  routes: { contacts: { scope: "contacts:read", view: ContactsPage } },
  navigation: [{ label: "Contacts", icon: ContactRound, order: 25, items: [{ label: "People & organizations", path: "contacts", scope: "contacts:read" }] }],
};

export default moduleDefinition;
