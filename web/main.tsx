import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { installDynamicSchoolSelectors } from "./dynamicSchoolSelectors";
import { installLegacyPrintBridge } from "./printing";
import { installJournalReversalGuard } from "./reversalGuard";
import "./styles.css";

installLegacyPrintBridge();
installDynamicSchoolSelectors();
installJournalReversalGuard();

createRoot(document.getElementById("root")!).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
