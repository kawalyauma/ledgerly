-- Tasks & Work Mobile Sync privacy v2.
-- Arbitrary task custom fields are intentionally server-only.
-- Existing change-feed task payloads were already safe; republish full safe task projections
-- so upgraded clients replace any v1 bootstrap records that contained customFields.

DELETE FROM mobile_sync_changes
WHERE module_key='tasks-work' AND collection_key='tasks';

INSERT INTO work_mobile_change_events(organization_id,collection_key,record_id,operation,payload_json)
SELECT t.organization_id,'tasks',t.id,'upsert',json_object(
  'id',t.id,
  'taskNumber',t.task_number,
  'projectId',t.project_id,
  'parentTaskId',t.parent_task_id,
  'title',t.title,
  'description',t.description,
  'status',t.status,
  'priority',t.priority,
  'startAt',t.start_at,
  'dueAt',t.due_at,
  'completedAt',t.completed_at,
  'estimatedMinutes',t.estimated_minutes,
  'actualMinutes',t.actual_minutes,
  'progress',t.progress,
  'updatedBy',t.updated_by
)
FROM work_tasks t
WHERE t.archived_at IS NULL;
