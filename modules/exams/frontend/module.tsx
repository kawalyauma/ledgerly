import { ClipboardList } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { ExamsWorkspace } from "./ExamsWorkspace";
import "./exams.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "exams",
  name: "Examinations",
  version: "1.0.0",
  order: 30,
  routes: {
    exams: { scope: "school:read", view: ExamsWorkspace },
  },
  navigation: [
    { label: "Examinations", icon: ClipboardList, order: 30, items: [{ label: "Examinations", path: "exams", scope: "school:read" }] },
  ],
};
export default moduleDefinition;
