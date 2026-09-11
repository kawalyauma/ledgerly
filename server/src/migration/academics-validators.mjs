export const ACADEMICS_RELATIONSHIP_CHECKS=Object.freeze([
 ["academics.scheme_class_tenant",`SELECT count(*)::bigint AS count FROM acad_schemes x JOIN school_classes p ON p.id=x.class_id WHERE p.organization_id<>x.organization_id`],
 ["academics.scheme_subject_tenant",`SELECT count(*)::bigint AS count FROM acad_schemes x JOIN school_subjects p ON p.id=x.subject_id WHERE p.organization_id<>x.organization_id`],
 ["academics.lesson_plan_scheme_item",`SELECT count(*)::bigint AS count FROM acad_lesson_plans x LEFT JOIN acad_scheme_items p ON p.id=x.scheme_item_id WHERE x.scheme_item_id IS NOT NULL AND p.id IS NULL`],
 ["academics.delivery_canonical_attendance",`SELECT count(*)::bigint AS count FROM acad_lesson_deliveries x LEFT JOIN att_sessions p ON p.id=x.canonical_attendance_session_id WHERE x.canonical_attendance_session_id IS NOT NULL AND p.id IS NULL`],
 ["academics.observation_followup",`SELECT count(*)::bigint AS count FROM acad_observations x LEFT JOIN acad_observations p ON p.id=x.followup_observation_id WHERE x.followup_observation_id IS NOT NULL AND p.id IS NULL`],
 ["academics.inspection_sample_student",`SELECT count(*)::bigint AS count FROM acad_inspection_samples x LEFT JOIN school_students p ON p.id=x.student_id WHERE x.student_id IS NOT NULL AND p.id IS NULL`],
]);
