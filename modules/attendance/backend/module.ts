import type { BackendModuleDefinition } from "../../backend-types";
import { attendanceRoutes } from "./routes";
import { attendanceDeviceRoutes } from "./device-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "attendance",
  name: "Attendance",
  version: "1.2.0",
  order: 26,
  publicRoutes: [{ basePath: "/api/v1/attendance/device", router: attendanceDeviceRoutes }],
  routes: [{ basePath: "/api/v1/attendance", router: attendanceRoutes }],
};
