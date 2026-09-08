import "./mobile-sync";
import type { BackendModuleDefinition } from "../../backend-types";
import { accountsRoutes } from "../../../src/routes/accounts";
import { adminRoutes } from "../../../src/routes/admin";
import { bankingRoutes } from "../../../src/routes/banking";
import { budgetsRoutes } from "../../../src/routes/budgets";
import { closingRoutes } from "../../../src/routes/closing";
import { complianceRoutes } from "../../../src/routes/compliance";
import { dashboardsRoutes } from "../../../src/routes/dashboards";
import { dimensionsRoutes } from "../../../src/routes/dimensions";
import { documentRenderingRoutes } from "../../../src/routes/document-rendering";
import { documentsRoutes } from "../../../src/routes/documents";
import { financeMaintenanceRoutes } from "../../../src/routes/finance-maintenance";
import { integrationsRoutes } from "../../../src/routes/integrations";
import { inventoryRoutes } from "../../../src/routes/inventory";
import { journalsRoutes } from "../../../src/routes/journals";
import { modulesRoutes } from "../../../src/routes/modules";
import { operationsRoutes } from "../../../src/routes/operations";
import { ordersRoutes } from "../../../src/routes/orders";
import { organizationsRoutes } from "../../../src/routes/organizations";
import { periodsRoutes } from "../../../src/routes/periods";
import { productsRoutes } from "../../../src/routes/products";
import { projectsRoutes } from "../../../src/routes/projects";
import { reportLibraryRoutes } from "../../../src/routes/report-library";
import { reportSchedulesRoutes } from "../../../src/routes/report-schedules";
import { reportsRoutes } from "../../../src/routes/reports";
import { taxRoutes } from "../../../src/routes/tax";
import { processPendingFinanceMobileIntents } from "./offline-intents";

export const moduleDefinition: BackendModuleDefinition = {
  key: "ledgerly-core",
  name: "Ledgerly Finance Core",
  version: "1.0.0",
  order: 10,
  routes: [
    { basePath: "/api/v1/accounts", router: accountsRoutes },
    { basePath: "/api/v1/admin", router: adminRoutes },
    { basePath: "/api/v1/banking", router: bankingRoutes },
    { basePath: "/api/v1/budgets", router: budgetsRoutes },
    { basePath: "/api/v1/closing", router: closingRoutes },
    { basePath: "/api/v1/compliance", router: complianceRoutes },
    { basePath: "/api/v1/dashboards", router: dashboardsRoutes },
    { basePath: "/api/v1/dimensions", router: dimensionsRoutes },
    { basePath: "/api/v1/documents", router: documentsRoutes },
    { basePath: "/api/v1/documents", router: documentRenderingRoutes },
    { basePath: "/api/v1/finance-maintenance", router: financeMaintenanceRoutes },
    { basePath: "/api/v1/integrations", router: integrationsRoutes },
    { basePath: "/api/v1/inventory", router: inventoryRoutes },
    { basePath: "/api/v1/journals", router: journalsRoutes },
    { basePath: "/api/v1/modules", router: modulesRoutes },
    { basePath: "/api/v1/operations", router: operationsRoutes },
    { basePath: "/api/v1/orders", router: ordersRoutes },
    { basePath: "/api/v1/organizations", router: organizationsRoutes },
    { basePath: "/api/v1/periods", router: periodsRoutes },
    { basePath: "/api/v1/products", router: productsRoutes },
    { basePath: "/api/v1/projects", router: projectsRoutes },
    { basePath: "/api/v1/report-library", router: reportLibraryRoutes },
    { basePath: "/api/v1/report-schedules", router: reportSchedulesRoutes },
    { basePath: "/api/v1/reports", router: reportsRoutes },
    { basePath: "/api/v1/tax", router: taxRoutes },
  ],
  scheduled: async env => {
    await processPendingFinanceMobileIntents(env.FINANCE_DB, { limit: 25 });
  },
};
