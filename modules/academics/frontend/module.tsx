import { BookOpenCheck } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AcademicsWorkspace } from "./AcademicsWorkspace";
import "./academics.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "academics",
  name: "Academics",
  version: "1.0.0",
  order: 25,
  routes: { academics: { scope: "school:read", view: AcademicsWorkspace } },
  navigation: [{ label: "Academics", icon: BookOpenCheck, order: 25, items: [{ label: "Academics", path: "academics", scope: "school:read" }] }],
};
export default moduleDefinition;
