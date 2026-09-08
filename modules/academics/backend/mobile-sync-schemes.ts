import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import type { MobileSyncMutation, MobileSyncMutationContext, PreparedMobileSyncMutation } from "../../mobile-sync/backend/contracts";
import { requireAcademicsWrite } from "./mobile-sync-permissions";
import { type R, guard, unguard, own, requireStableId } from "./mobile-sync-common";
const schemeCreate = z.object({ academicYearId: z.string(), termId: z.string(), classId: z.string(), streamId: z.string().nullable().optional(), subjectId: z.string(), teacherUserId: z.string().optional(), title: z.string().min(1).max(250), teacherReflection: z.string().max(10000).nullable().optional() }).strict();
const schemeEdit = z.object({ title: z.string().min(1).max(250).optional(), teacherReflection: z.string().max(10000).nullable().optional() }).strict();
export async function prepareScheme(c: MobileSyncMutationContext, m: MobileSyncMutation): Promise<PreparedMobileSyncMutation> {
    await requireAcademicsWrite(c);
    if (m.kind === "delete")
        throw new AppError(409, "SERVER_MANAGED_LIFECYCLE", "Schemes cannot be deleted offline");
    requireStableId(m.recordId, "Scheme");
    const old = await c.db.prepare("SELECT * FROM acad_schemes WHERE id=? AND organization_id=?").bind(m.recordId, c.organizationId).first<R>();
    if (!old) {
        if (c.currentVersion !== 0)
            throw new AppError(409, "RECORD_MISSING", "Scheme no longer exists");
        const p = schemeCreate.safeParse(m.payload);
        if (!p.success)
            throw new AppError(422, "VALIDATION_ERROR", "Invalid scheme", p.error.flatten());
        const teacher = p.data.teacherUserId ?? c.userId;
        await own(c, teacher);
        const st = [guard(c.db, "schemes", m.recordId, c.organizationId), c.db.prepare(`INSERT INTO acad_schemes(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_user_id,title,status,version_no,teacher_reflection,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',1,?,?,?,?)`).bind(m.recordId, c.organizationId, p.data.academicYearId, p.data.termId, p.data.classId, p.data.streamId ?? null, p.data.subjectId, teacher, p.data.title, p.data.teacherReflection ?? null, c.userId, m.clientTimestamp, m.clientTimestamp), unguard(c.db, "schemes", m.recordId, c.organizationId)];
        return { statements: st, serverPayload: { id: m.recordId, ...p.data, teacherUserId: teacher, status: "draft", versionNo: 1, coveragePercent: 0, createdBy: c.userId, createdAt: m.clientTimestamp, updatedAt: m.clientTimestamp } };
    }
    await own(c, String(old.teacher_user_id));
    if (!["draft", "rejected"].includes(String(old.status)))
        throw new AppError(409, "SCHEME_LOCKED", "Only draft or rejected schemes can be edited offline");
    const p = schemeEdit.safeParse(m.payload);
    if (!p.success)
        throw new AppError(422, "VALIDATION_ERROR", "Invalid scheme changes", p.error.flatten());
    const e = Object.entries(p.data);
    if (!e.length)
        throw new AppError(422, "VALIDATION_ERROR", "No scheme changes supplied");
    const sets = e.map(([k]) => `${k === "teacherReflection" ? "teacher_reflection" : "title"}=?`), vals = e.map(([, v]) => v ?? null);
    return { statements: [guard(c.db, "schemes", m.recordId, c.organizationId), c.db.prepare(`UPDATE acad_schemes SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(...vals, m.recordId, c.organizationId), unguard(c.db, "schemes", m.recordId, c.organizationId)], serverPayload: { ...old, ...p.data, id: m.recordId } };
}
const itemShape = z.object({ schemeId: z.string().optional(), sequenceNo: z.number().int().positive().optional(), weekNo: z.number().int().positive().optional(), lessonNo: z.number().int().positive().nullable().optional(), topic: z.string().min(1).max(500).optional(), subtopic: z.string().max(500).nullable().optional(), learningObjectives: z.string().max(10000).nullable().optional(), competencies: z.string().max(10000).nullable().optional(), teachingMethods: z.string().max(10000).nullable().optional(), learningMaterials: z.string().max(10000).nullable().optional(), referencesText: z.string().max(10000).nullable().optional(), plannedActivities: z.string().max(20000).nullable().optional(), assessmentActivities: z.string().max(20000).nullable().optional(), plannedDate: z.string().nullable().optional(), coverageStatus: z.enum(["planned", "in_progress", "covered", "carried_forward", "skipped"]).optional(), teacherReflection: z.string().max(10000).nullable().optional() }).strict();
export async function prepareSchemeItem(c: MobileSyncMutationContext, m: MobileSyncMutation): Promise<PreparedMobileSyncMutation> {
    await requireAcademicsWrite(c);
    requireStableId(m.recordId, "Scheme item");
    const old = await c.db.prepare("SELECT * FROM acad_scheme_items WHERE id=? AND organization_id=?").bind(m.recordId, c.organizationId).first<R>();
    const p = itemShape.safeParse(m.payload);
    if (!p.success)
        throw new AppError(422, "VALIDATION_ERROR", "Invalid scheme item", p.error.flatten());
    const schemeId = String(old?.scheme_id ?? p.data.schemeId ?? "");
    if (!schemeId)
        throw new AppError(422, "VALIDATION_ERROR", "schemeId is required");
    const sh = await c.db.prepare("SELECT teacher_user_id AS teacherUserId,status FROM acad_schemes WHERE id=? AND organization_id=?").bind(schemeId, c.organizationId).first<R>();
    if (!sh)
        throw new AppError(404, "SCHEME_NOT_FOUND", "Scheme not found");
    await own(c, String(sh.teacherUserId));
    if (!["draft", "rejected"].includes(String(sh.status)))
        throw new AppError(409, "SCHEME_LOCKED", "Scheme items can only change while the scheme is draft or rejected");
    if (m.kind === "delete") {
        if (!old)
            throw new AppError(404, "SCHEME_ITEM_NOT_FOUND", "Scheme item not found");
        return { statements: [guard(c.db, "scheme-items", m.recordId, c.organizationId), c.db.prepare("DELETE FROM acad_scheme_items WHERE id=? AND organization_id=?").bind(m.recordId, c.organizationId), unguard(c.db, "scheme-items", m.recordId, c.organizationId), c.db.prepare(`UPDATE acad_schemes SET coverage_percent=COALESCE((SELECT ROUND(100.0*SUM(CASE WHEN coverage_status='covered' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) FROM acad_scheme_items WHERE scheme_id=? AND organization_id=?),0),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(schemeId, c.organizationId, schemeId, c.organizationId)], result: { deleted: true, schemeId } };
    }
    const map: R = { weekNo: "week_no", lessonNo: "lesson_no", topic: "topic", subtopic: "subtopic", learningObjectives: "learning_objectives", competencies: "competencies", teachingMethods: "teaching_methods", learningMaterials: "learning_materials", referencesText: "references_text", plannedActivities: "planned_activities", assessmentActivities: "assessment_activities", plannedDate: "planned_date", coverageStatus: "coverage_status", teacherReflection: "teacher_reflection", sequenceNo: "sequence_no" };
    if (!old) {
        if (c.currentVersion !== 0)
            throw new AppError(409, "RECORD_MISSING", "Scheme item no longer exists");
        if (!p.data.weekNo || !p.data.topic)
            throw new AppError(422, "VALIDATION_ERROR", "weekNo and topic are required");
        const seq = p.data.sequenceNo ?? Number((await c.db.prepare("SELECT COALESCE(MAX(sequence_no),0)+1 n FROM acad_scheme_items WHERE scheme_id=?").bind(schemeId).first<{ n: number; }>())?.n ?? 1);
        const st = [guard(c.db, "scheme-items", m.recordId, c.organizationId), c.db.prepare(`INSERT INTO acad_scheme_items(id,organization_id,scheme_id,sequence_no,week_no,lesson_no,topic,subtopic,learning_objectives,competencies,teaching_methods,learning_materials,references_text,planned_activities,assessment_activities,planned_date,coverage_status,teacher_reflection,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(m.recordId, c.organizationId, schemeId, seq, p.data.weekNo, p.data.lessonNo ?? null, p.data.topic, p.data.subtopic ?? null, p.data.learningObjectives ?? null, p.data.competencies ?? null, p.data.teachingMethods ?? null, p.data.learningMaterials ?? null, p.data.referencesText ?? null, p.data.plannedActivities ?? null, p.data.assessmentActivities ?? null, p.data.plannedDate ?? null, p.data.coverageStatus ?? "planned", p.data.teacherReflection ?? null, m.clientTimestamp, m.clientTimestamp), unguard(c.db, "scheme-items", m.recordId, c.organizationId), c.db.prepare(`UPDATE acad_schemes SET coverage_percent=COALESCE((SELECT ROUND(100.0*SUM(CASE WHEN coverage_status='covered' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) FROM acad_scheme_items WHERE scheme_id=? AND organization_id=?),0),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(schemeId, c.organizationId, schemeId, c.organizationId)];
        return { statements: st, serverPayload: { id: m.recordId, schemeId, sequenceNo: seq, ...p.data } };
    }
    const e = Object.entries(p.data).filter(([k]) => k !== "schemeId" && map[k]);
    if (!e.length)
        throw new AppError(422, "VALIDATION_ERROR", "No scheme item changes supplied");
    const st = [guard(c.db, "scheme-items", m.recordId, c.organizationId), c.db.prepare(`UPDATE acad_scheme_items SET ${e.map(([k]) => `${map[k]}=?`).join(",")},covered_at=CASE WHEN ?='covered' THEN COALESCE(covered_at,CURRENT_TIMESTAMP) WHEN ? IS NOT NULL AND ?<>'covered' THEN NULL ELSE covered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(...e.map(([, v]) => v ?? null), p.data.coverageStatus ?? null, p.data.coverageStatus ?? null, p.data.coverageStatus ?? null, m.recordId, c.organizationId), unguard(c.db, "scheme-items", m.recordId, c.organizationId), c.db.prepare(`UPDATE acad_schemes SET coverage_percent=COALESCE((SELECT ROUND(100.0*SUM(CASE WHEN coverage_status='covered' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) FROM acad_scheme_items WHERE scheme_id=? AND organization_id=?),0),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(schemeId, c.organizationId, schemeId, c.organizationId)];
    return { statements: st, serverPayload: { ...old, ...p.data, id: m.recordId, schemeId } };
}
