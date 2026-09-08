import type { BackendModuleDefinition } from "../../backend-types";
import { securityCameraRoutes } from "./routes";
import { securityCameraDeviceRoutes } from "./device-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "security-camera",
  name: "Security Cameras",
  version: "0.1.0",
  order: 43,
  publicRoutes: [{ basePath: "/api/v1/security-camera", router: securityCameraDeviceRoutes }],
  routes: [{ basePath: "/api/v1/security-camera", router: securityCameraRoutes }],
};
