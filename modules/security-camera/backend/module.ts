import type { BackendModuleDefinition } from "../../backend-types";
import { securityCameraRoutes } from "./routes";
import { securityCameraDeviceRoutes } from "./device-routes";
import { securityCameraServerRoutes } from "./server-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "security-camera",
  name: "Security Cameras",
  version: "0.5.0",
  order: 43,
  publicRoutes: [
    { basePath: "/api/v1/security-camera", router: securityCameraDeviceRoutes },
    { basePath: "/api/v1/security-camera", router: securityCameraServerRoutes },
  ],
  routes: [{ basePath: "/api/v1/security-camera", router: securityCameraRoutes }],
};
