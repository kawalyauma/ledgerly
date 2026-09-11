import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationPhase } from "../src/migration/phases.mjs";

const expected = Object.freeze({
  "school-reference": [
    "school_profiles","school_branches","school_academic_years","school_terms","school_departments","school_class_levels","school_classes","school_streams","school_subjects","school_class_subjects","school_lesson_periods",
  ],
  "school-configuration": [
    "school_files","school_grading_scales","school_grade_boundaries","school_divisions","school_assessment_types","school_promotion_rules","school_calendar_events","school_fee_categories","school_payment_methods","school_settings","school_document_templates","school_roles","school_role_permissions","school_user_profiles","school_user_roles","school_user_access","school_temporary_permissions","school_security_policies","school_impersonation_sessions","school_fee_accounting_settings","school_fee_structures","school_fee_structure_lines","school_fee_discount_schemes","app_modules","organization_modules",
  ],
  "school-people": [
    "school_admission_applications","school_students","school_guardians","school_student_guardians","school_authorized_pickups","school_student_medical","school_enrollments","school_student_status_history","school_student_promotions","school_student_transfers","school_student_documents","school_student_notes","school_student_tags","school_student_tag_links","school_student_siblings","school_student_timeline","school_promotion_runs","school_promotion_run_items","school_discipline_offence_types","school_discipline_incidents","school_discipline_actions","school_discipline_parent_meetings","school_discipline_followups","school_discipline_attachments","school_import_jobs",
  ],
  "school-staff": [
    "school_staff_positions","school_staff_profiles","school_staff_emergency_contacts","school_staff_qualifications","school_staff_subjects","school_staff_teaching_assignments","school_staff_documents",
  ],
  attendance: [
    "school_student_attendance_sessions","school_student_attendance_records","school_student_attendance_changes","school_staff_attendance_day_locks","school_staff_attendance_records","school_staff_attendance_events","school_staff_attendance_changes","att_policies","att_sessions","att_records","att_devices","att_device_credentials","att_device_sync_batches","att_events","att_biometric_profiles","att_person_identifiers","att_biometric_enrollments","att_test_mode_grants","att_exceptions","att_corrections","att_notification_rules","att_audit","att_biometric_templates","att_biometric_enrollment_jobs","att_biometric_settings","att_biometric_template_samples","att_device_enrollment_tokens","att_mobile_reconciliation_issues",
  ],
  academics: [
    "acad_rooms","acad_teacher_availability","acad_timetables","acad_timetable_entries","acad_timetable_changes","acad_substitute_lessons","acad_schemes","acad_scheme_items","acad_scheme_versions","acad_lesson_plan_templates","acad_lesson_plans","acad_lesson_deliveries","acad_delivery_attachments","acad_observations","acad_observation_attachments","acad_inspections","acad_inspection_samples","acad_inspection_attachments",
  ],
  books: ["bks_stock_movements","bks_distribution_batches","bks_distributions","bks_mobile_operation_intents"],
});

test("owned school domains expose every persistent D1 table in migration descriptors", () => {
  for (const [phaseName, tableNames] of Object.entries(expected)) {
    const actual = new Set(getMigrationPhase(phaseName).tables.map((table) => table.name));
    for (const tableName of tableNames) assert.equal(actual.has(tableName), true, `${phaseName} is missing ${tableName}`);
  }
});

test("finance and payroll transaction ownership does not leak into the school stream", () => {
  const owned = new Set(Object.keys(expected).flatMap((phaseName) => getMigrationPhase(phaseName).tables.map((table) => table.name)));
  for (const foreignOwned of [
    "school_staff_compensation","school_staff_salary_payments","school_student_fee_charges","school_fee_receipts","school_fee_payment_plans","school_fee_billing_batches","payroll_lines","payments",
  ]) assert.equal(owned.has(foreignOwned), false, `${foreignOwned} belongs to finance/payroll ownership`);
});

test("shared mobile-sync core remains an external integration dependency instead of being duplicated", () => {
  const owned = new Set(Object.keys(expected).flatMap((phaseName) => getMigrationPhase(phaseName).tables.map((table) => table.name)));
  for (const shared of ["mobile_sync_devices","mobile_offline_grants","mobile_sync_record_versions","mobile_sync_changes","mobile_sync_tombstones"]) {
    assert.equal(owned.has(shared), false, `${shared} is owned by the shared mobile-sync stream`);
  }
  const attendance = getMigrationPhase("attendance");
  const books = getMigrationPhase("books");
  assert.ok(attendance.tables.some((table) => table.name === "att_events"));
  assert.ok(books.tables.some((table) => table.name === "bks_mobile_operation_intents"));
});
