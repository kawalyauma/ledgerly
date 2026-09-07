import type { BackendModuleDefinition } from "../../backend-types";
import { attendanceRoutes } from "./routes";
import { attendanceDeviceRoutes } from "./device-routes";
import { attendanceDeviceEnrollmentRoutes,attendanceKioskEnrollmentRoutes } from "./enrollment-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "attendance",
  name: "Attendance",
  version: "1.3.0",
  order: 26,
  publicRoutes: [
    { basePath: "/api/v1/attendance/device", router: attendanceDeviceRoutes },
    { basePath: "/api/v1/attendance/device-enrollment", router: attendanceDeviceEnrollmentRoutes },
  ],
  routes: [
    { basePath: "/api/v1/attendance", router: attendanceRoutes },
    { basePath: "/api/v1/attendance/kiosk-enrollment", router: attendanceKioskEnrollmentRoutes },
  ],
};
