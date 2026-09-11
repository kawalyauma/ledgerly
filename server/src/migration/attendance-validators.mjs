export const ATTENDANCE_RELATIONSHIP_CHECKS = Object.freeze([
  ["attendance.legacy_student", `SELECT count(*)::bigint AS count FROM school_student_attendance_records x LEFT JOIN school_students p ON p.id=x.student_id WHERE p.id IS NULL`],
  ["attendance.legacy_staff", `SELECT count(*)::bigint AS count FROM school_staff_attendance_records x LEFT JOIN school_staff_profiles p ON p.id=x.staff_id WHERE p.id IS NULL`],
  ["attendance.session_class_tenant", `SELECT count(*)::bigint AS count FROM att_sessions x JOIN school_classes p ON p.id=x.class_id WHERE x.class_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["attendance.record_session", `SELECT count(*)::bigint AS count FROM att_records x LEFT JOIN att_sessions p ON p.id=x.session_id WHERE x.session_id IS NOT NULL AND p.id IS NULL`],
  ["attendance.event_batch", `SELECT count(*)::bigint AS count FROM att_events x LEFT JOIN att_device_sync_batches p ON p.id=x.sync_batch_id WHERE x.sync_batch_id IS NOT NULL AND p.id IS NULL`],
  ["attendance.event_mobile_device", `SELECT count(*)::bigint AS count FROM att_events x LEFT JOIN mobile_sync_devices p ON p.id=x.mobile_sync_device_id WHERE x.mobile_sync_device_id IS NOT NULL AND p.id IS NULL`],
  ["attendance.event_mobile_device_tenant", `SELECT count(*)::bigint AS count FROM att_events x JOIN mobile_sync_devices p ON p.id=x.mobile_sync_device_id WHERE x.mobile_sync_device_id IS NOT NULL AND p.organization_id<>x.organization_id`],
  ["attendance.biometric_profile", `SELECT count(*)::bigint AS count FROM att_biometric_templates x LEFT JOIN att_biometric_profiles p ON p.id=x.profile_id WHERE p.id IS NULL`],
  ["attendance.device_token", `SELECT count(*)::bigint AS count FROM att_device_enrollment_tokens x LEFT JOIN att_devices p ON p.id=x.device_id WHERE p.id IS NULL`],
  ["attendance.reconciliation_event", `SELECT count(*)::bigint AS count FROM att_mobile_reconciliation_issues x LEFT JOIN att_events p ON p.id=x.event_id WHERE p.id IS NULL`],
]);
