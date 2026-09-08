import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import type { MobileSyncMutation, MobileSyncMutationContext, PreparedMobileSyncMutation } from "../../mobile-sync/backend/contracts";
import { requireAcademicsWrite } from "./mobile-sync-permissions";
import { type R, own, requireStableId } from "./mobile-sync-common";
const action = z.discriminatedUnion("action", [
    z.object({ action: z.literal("submit_scheme"), schemeId: z.string() }), z.object({ action: z.literal("submit_lesson_plan"), lessonPlanId: z.string() }), z.object({ action: z.literal("ack_observation"), observationId: z.string(), response: z.string().max(10000).nullable().optional() })
]);
export async function prepareAcademicAction(c: MobileSyncMutationContext, m: MobileSyncMutation): Promise<PreparedMobileSyncMutation> {
    await requireAcademicsWrite(c);
    if (m.kind === "delete")
        throw new AppError(409, "APPEND_ONLY_COLLECTION", "Academic actions cannot be deleted");
    requireStableId(m.recordId, "Action");
    const p = action.safeParse(m.payload);
    if (!p.success)
        throw new AppError(422, "VALIDATION_ERROR", "Invalid academic action", p.error.flatten());
    const d = p.data, st: D1PreparedStatement[] = [];
    if (d.action === "submit_scheme") {
        const x = await c.db.prepare("SELECT teacher_user_id teacher,status FROM acad_schemes WHERE id=? AND organization_id=?").bind(d.schemeId, c.organizationId).first<R>();
        if (!x)
            throw new AppError(404, "SCHEME_NOT_FOUND", "Scheme not found");
        await own(c, String(x.teacher));
        if (!["draft", "rejected"].includes(String(x.status)))
            throw new AppError(409, "INVALID_STATUS", "Scheme cannot be submitted from its current status");
        st.push(c.db.prepare("UPDATE acad_schemes SET status='submitted_hod',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(d.schemeId, c.organizationId));
    }
    else if (d.action === "submit_lesson_plan") {
        const x = await c.db.prepare("SELECT teacher_user_id teacher,status FROM acad_lesson_plans WHERE id=? AND organization_id=?").bind(d.lessonPlanId, c.organizationId).first<R>();
        if (!x)
            throw new AppError(404, "LESSON_PLAN_NOT_FOUND", "Lesson plan not found");
        await own(c, String(x.teacher));
        if (x.status !== "draft")
            throw new AppError(409, "INVALID_STATUS", "Only draft lesson plans can be submitted");
        st.push(c.db.prepare("UPDATE acad_lesson_plans SET status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(d.lessonPlanId, c.organizationId));
    }
    else {
        const x = await c.db.prepare("SELECT teacher_user_id teacher,status,followup_date followup FROM acad_observations WHERE id=? AND organization_id=?").bind(d.observationId, c.organizationId).first<R>();
        if (!x)
            throw new AppError(404, "OBSERVATION_NOT_FOUND", "Observation not found");
        if (String(x.teacher) !== c.userId)
            throw new AppError(403, "FORBIDDEN", "Only the observed teacher can acknowledge this observation");
        st.push(c.db.prepare("UPDATE acad_observations SET status=CASE WHEN followup_date IS NULL THEN 'acknowledged' ELSE 'followup_due' END,teacher_acknowledged_at=CURRENT_TIMESTAMP,teacher_response=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(d.response ?? null, d.observationId, c.organizationId));
    }
    return { statements: st, serverPayload: { id: m.recordId, ...d, queuedAt: m.clientTimestamp, appliedBy: c.userId } };
}
