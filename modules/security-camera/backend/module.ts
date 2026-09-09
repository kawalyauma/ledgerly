import type { BackendModuleDefinition } from "../../backend-types";
import { securityCameraRoutes } from "./routes";
import { securityCameraDeviceRoutes } from "./device-routes";
import { securityCameraServerRoutes } from "./server-routes";
import { securityCameraOperationsRoutes } from "./operations-routes";
import { securityCameraServerOperationsRoutes } from "./server-operations-routes";
import { securityCameraDeviceOperationsRoutes } from "./device-operations-routes";
import { securityCameraEventRoutes } from "./event-routes";
import { securityCameraServerEventRoutes } from "./server-event-routes";
import { securityCameraFleetAdminRoutes } from "./fleet-admin-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "security-camera",
  name: "Security Cameras",
  version: "0.8.0",
  order: 43,
  publicRoutes: [
    { basePath: "/api/v1/security-camera", router: securityCameraDeviceRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraDeviceOperationsRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraServerRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraServerOperationsRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraServerEventRoutes },
  ],
  routes: [
    { basePath: "/api/v1/security-camera", router: securityCameraRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraOperationsRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraEventRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraFleetAdminRoutes },
  ],
};
