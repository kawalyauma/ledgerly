import { BriefcaseBusiness } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { WorkManagementPage } from "./WorkManagementPage";
import "./work.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "tasks-work",
  name: "Tasks & Work",
  version: "1.1.0",
  order: 25,
  routes: {
    work: { view: WorkManagementPage },
  },
  navigation: [
    { label: "Tasks & Work", icon: BriefcaseBusiness, order: 25, items: [{ label: "Tasks & Work", path: "work" }] },
  ],
};
export default moduleDefinition;
