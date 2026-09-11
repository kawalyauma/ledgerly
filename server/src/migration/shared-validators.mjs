export const MOBILE_SYNC_RELATIONSHIP_CHECKS = Object.freeze([
  ["mobile_sync_devices.organization", `SELECT count(*)::bigint AS count FROM mobile_sync_devices x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["mobile_sync_devices.user", `SELECT count(*)::bigint AS count FROM mobile_sync_devices x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL`],
  ["mobile_sync_batches.device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_batches x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["mobile_sync_operations.device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_operations x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["mobile_sync_operations.batch_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_operations x LEFT JOIN mobile_sync_batches p ON p.id=x.batch_id AND p.organization_id=x.organization_id AND p.device_id=x.device_id WHERE p.id IS NULL`],
  ["mobile_sync_conflicts.device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_conflicts x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["mobile_sync_pull_deliveries.device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_pull_deliveries x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["mobile_sync_bootstraps.device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_bootstraps x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["mobile_sync_record_versions.last_device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_record_versions x LEFT JOIN mobile_sync_devices p ON p.id=x.last_device_id AND p.organization_id=x.organization_id WHERE x.last_device_id IS NOT NULL AND p.id IS NULL`],
  ["mobile_sync_tombstones.device_tenant", `SELECT count(*)::bigint AS count FROM mobile_sync_tombstones x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE x.device_id IS NOT NULL AND p.id IS NULL`],
]);

export const CONTACTS_RELATIONSHIP_CHECKS = Object.freeze([
  ["contacts.organization", `SELECT count(*)::bigint AS count FROM contacts x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["contact_addresses.contact_tenant", `SELECT count(*)::bigint AS count FROM contact_addresses x LEFT JOIN contacts p ON p.id=x.contact_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["contact_people.contact_tenant", `SELECT count(*)::bigint AS count FROM contact_people x LEFT JOIN contacts p ON p.id=x.contact_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
]);

export const COMMUNICATIONS_RELATIONSHIP_CHECKS = Object.freeze([
  ["communication_types.organization", `SELECT count(*)::bigint AS count FROM communication_message_types x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["communication_campaigns.organization", `SELECT count(*)::bigint AS count FROM communication_campaigns x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["communication_campaigns.message_type_tenant", `SELECT count(*)::bigint AS count FROM communication_campaigns x LEFT JOIN communication_message_types p ON p.id=x.message_type_id AND p.organization_id=x.organization_id WHERE x.message_type_id IS NOT NULL AND p.id IS NULL`],
  ["communication_recipients.campaign_tenant", `SELECT count(*)::bigint AS count FROM communication_recipients x LEFT JOIN communication_campaigns p ON p.id=x.campaign_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["communication_deliveries.campaign_tenant", `SELECT count(*)::bigint AS count FROM communication_deliveries x LEFT JOIN communication_campaigns p ON p.id=x.campaign_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["communication_deliveries.recipient_tenant", `SELECT count(*)::bigint AS count FROM communication_deliveries x LEFT JOIN communication_recipients p ON p.id=x.recipient_snapshot_id AND p.organization_id=x.organization_id AND p.campaign_id=x.campaign_id WHERE p.id IS NULL`],
]);

export const HUMAN_RESOURCES_RELATIONSHIP_CHECKS = Object.freeze([
  ["hr_departments.organization", `SELECT count(*)::bigint AS count FROM hr_departments x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["hr_employees.department_tenant", `SELECT count(*)::bigint AS count FROM hr_employees x LEFT JOIN hr_departments p ON p.id=x.department_id AND p.organization_id=x.organization_id WHERE x.department_id IS NOT NULL AND p.id IS NULL`],
  ["hr_employees.contact_tenant", `SELECT count(*)::bigint AS count FROM hr_employees x LEFT JOIN contacts p ON p.id=x.contact_id AND p.organization_id=x.organization_id WHERE x.contact_id IS NOT NULL AND p.id IS NULL`],
  ["hr_employees.manager_tenant", `SELECT count(*)::bigint AS count FROM hr_employees x LEFT JOIN hr_employees p ON p.id=x.manager_employee_id AND p.organization_id=x.organization_id WHERE x.manager_employee_id IS NOT NULL AND p.id IS NULL`],
  ["hr_leave_requests.employee_tenant", `SELECT count(*)::bigint AS count FROM hr_leave_requests x LEFT JOIN hr_employees p ON p.id=x.employee_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["hr_leave_requests.type_tenant", `SELECT count(*)::bigint AS count FROM hr_leave_requests x LEFT JOIN hr_leave_types p ON p.id=x.leave_type_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["hr_onboarding_tasks.employee_tenant", `SELECT count(*)::bigint AS count FROM hr_onboarding_tasks x LEFT JOIN hr_employees p ON p.id=x.employee_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["hr_mobile_leave_intents.employee_tenant", `SELECT count(*)::bigint AS count FROM hr_mobile_leave_intents x LEFT JOIN hr_employees p ON p.id=x.employee_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
  ["hr_mobile_leave_intents.device_tenant", `SELECT count(*)::bigint AS count FROM hr_mobile_leave_intents x LEFT JOIN mobile_sync_devices p ON p.id=x.device_id AND p.organization_id=x.organization_id WHERE x.device_id IS NOT NULL AND p.id IS NULL`],
  ["hr_mobile_onboarding_intents.task_tenant", `SELECT count(*)::bigint AS count FROM hr_mobile_onboarding_intents x LEFT JOIN hr_onboarding_tasks p ON p.id=x.task_id AND p.organization_id=x.organization_id WHERE p.id IS NULL`],
]);
