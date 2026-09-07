import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { schoolSetupRoutes } from "./setup";
import { schoolIamRoutes } from "./iam";
import { schoolStudentsRoutes } from "./students";
import { schoolStaffRoutes } from "./staff";
import { schoolFileRoutes } from "./files";
import { schoolFeesRoutes } from "./fees";
import { schoolPromotionRoutes } from "./promotions";
import { schoolDisciplineRoutes } from "./discipline";
import { ensureSchoolDefaults } from "./bootstrap";

/**
 * School Management plugin root.
 * The plugin intentionally reuses Ledgerly's organization, identity, session,
 * scope, audit and accounting infrastructure instead of duplicating them.
 */
export const schoolRoutes = new Hono<{Bindings:Env;Variables:AppVariables}>();
schoolRoutes.get("/manifest", c => c.json({
  data: {
    key: "school-management", name: "School Management", version: "1.9.0",
    backendModules: ["setup", "iam", "student-management", "promotion-engine", "discipline-behaviour", "staff-teacher-management", "files", "fees-billing"],
    plannedModules: ["library", "boarding", "transport"],
    integratesWith: ["academics", "exams", "communications"],
    accountingIntegration: true,
  }
}));
schoolRoutes.use("*", requireModuleEnabled("school-management"));
schoolRoutes.use("*", async (c,next)=>{const p=c.get("principal");await ensureSchoolDefaults(c.env.FINANCE_DB,p.organizationId,p.userId);await next();});
schoolRoutes.route("/setup", schoolSetupRoutes);
schoolRoutes.route("/iam", schoolIamRoutes);
schoolRoutes.route("/student-management", schoolStudentsRoutes);
schoolRoutes.route("/promotion", schoolPromotionRoutes);
schoolRoutes.route("/discipline", schoolDisciplineRoutes);
schoolRoutes.route("/staff-management", schoolStaffRoutes);
schoolRoutes.route("/files", schoolFileRoutes);

schoolRoutes.route("/fees", schoolFeesRoutes);
