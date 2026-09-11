export const BOOKS_RELATIONSHIP_CHECKS=Object.freeze([
 ["books.batch_class_tenant",`SELECT count(*)::bigint AS count FROM bks_distribution_batches x JOIN school_classes p ON p.id=x.class_id WHERE p.organization_id<>x.organization_id`],
 ["books.distribution_student",`SELECT count(*)::bigint AS count FROM bks_distributions x LEFT JOIN school_students p ON p.id=x.student_id WHERE p.id IS NULL`],
 ["books.distribution_student_tenant",`SELECT count(*)::bigint AS count FROM bks_distributions x JOIN school_students p ON p.id=x.student_id WHERE p.organization_id<>x.organization_id`],
 ["books.distribution_batch",`SELECT count(*)::bigint AS count FROM bks_distributions x LEFT JOIN bks_distribution_batches p ON p.id=x.batch_id WHERE x.batch_id IS NOT NULL AND p.id IS NULL`],
 ["books.mobile_device",`SELECT count(*)::bigint AS count FROM bks_mobile_operation_intents x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id WHERE x.device_id IS NOT NULL AND p.id IS NULL`],
 ["books.mobile_device_tenant",`SELECT count(*)::bigint AS count FROM bks_mobile_operation_intents x JOIN mobile_sync_devices p ON p.id=x.device_id WHERE x.device_id IS NOT NULL AND p.organization_id<>x.organization_id`],
]);
