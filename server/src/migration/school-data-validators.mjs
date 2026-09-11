export const SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS = Object.freeze([
  ["school_config.role_permission_role", `SELECT count(*)::bigint AS count FROM school_role_permissions x LEFT JOIN school_roles p ON p.id=x.role_id WHERE p.id IS NULL`],
  ["school_config.template_file", `SELECT count(*)::bigint AS count FROM school_document_templates x LEFT JOIN school_files p ON p.id=x.file_id WHERE x.file_id IS NOT NULL AND p.id IS NULL`],
  ["school_config.calendar_term_tenant", `SELECT count(*)::bigint AS count FROM school_calendar_events x JOIN school_terms p ON p.id=x.term_id WHERE x.term_id IS NOT NULL AND p.organization_id<>x.organization_id`],
]);

export const SCHOOL_PEOPLE_RELATIONSHIP_CHECKS = Object.freeze([
  ["school_people.student_org", `SELECT count(*)::bigint AS count FROM school_students x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["school_people.student_class_tenant", `SELECT count(*)::bigint AS count FROM school_students x JOIN school_classes p ON p.id=x.current_class_id WHERE x.current_class_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["school_people.student_contact", `SELECT count(*)::bigint AS count FROM school_students x LEFT JOIN contacts p ON p.id=x.contact_id WHERE x.contact_id IS NOT NULL AND p.id IS NULL`],
  ["school_people.student_contact_tenant", `SELECT count(*)::bigint AS count FROM school_students x JOIN contacts p ON p.id=x.contact_id WHERE x.contact_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["school_people.sponsor_contact", `SELECT count(*)::bigint AS count FROM school_students x LEFT JOIN contacts p ON p.id=x.financial_sponsor_contact_id WHERE x.financial_sponsor_contact_id IS NOT NULL AND p.id IS NULL`],
  ["school_people.sponsor_contact_tenant", `SELECT count(*)::bigint AS count FROM school_students x JOIN contacts p ON p.id=x.financial_sponsor_contact_id WHERE x.financial_sponsor_contact_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["school_people.guardian_contact", `SELECT count(*)::bigint AS count FROM school_guardians x LEFT JOIN contacts p ON p.id=x.contact_id WHERE x.contact_id IS NOT NULL AND p.id IS NULL`],
  ["school_people.guardian_contact_tenant", `SELECT count(*)::bigint AS count FROM school_guardians x JOIN contacts p ON p.id=x.contact_id WHERE x.contact_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["school_people.guardian_link_student", `SELECT count(*)::bigint AS count FROM school_student_guardians x LEFT JOIN school_students p ON p.id=x.student_id WHERE p.id IS NULL`],
  ["school_people.guardian_link_guardian", `SELECT count(*)::bigint AS count FROM school_student_guardians x LEFT JOIN school_guardians p ON p.id=x.guardian_id WHERE p.id IS NULL`],
  ["school_people.enrollment_student", `SELECT count(*)::bigint AS count FROM school_enrollments x LEFT JOIN school_students p ON p.id=x.student_id WHERE p.id IS NULL`],
  ["school_people.discipline_student", `SELECT count(*)::bigint AS count FROM school_discipline_incidents x LEFT JOIN school_students p ON p.id=x.student_id WHERE p.id IS NULL`],
  ["school_people.promotion_student", `SELECT count(*)::bigint AS count FROM school_promotion_run_items x LEFT JOIN school_students p ON p.id=x.student_id WHERE p.id IS NULL`],
]);

export const SCHOOL_STAFF_RELATIONSHIP_CHECKS = Object.freeze([
  ["school_staff.position_department_tenant", `SELECT count(*)::bigint AS count FROM school_staff_positions x JOIN school_departments p ON p.id=x.department_id WHERE x.department_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["school_staff.profile_contact", `SELECT count(*)::bigint AS count FROM school_staff_profiles x LEFT JOIN contacts p ON p.id=x.contact_id WHERE p.id IS NULL`],
  ["school_staff.profile_contact_tenant", `SELECT count(*)::bigint AS count FROM school_staff_profiles x JOIN contacts p ON p.id=x.contact_id WHERE p.organization_id<>x.organization_id`],
  ["school_staff.subject_staff", `SELECT count(*)::bigint AS count FROM school_staff_subjects x LEFT JOIN school_staff_profiles p ON p.id=x.staff_id WHERE p.id IS NULL`],
  ["school_staff.subject_subject", `SELECT count(*)::bigint AS count FROM school_staff_subjects x LEFT JOIN school_subjects p ON p.id=x.subject_id WHERE p.id IS NULL`],
  ["school_staff.assignment_class_tenant", `SELECT count(*)::bigint AS count FROM school_staff_teaching_assignments x JOIN school_classes p ON p.id=x.class_id WHERE p.organization_id<>x.organization_id`],
]);
