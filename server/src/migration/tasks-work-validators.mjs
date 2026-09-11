export const TASKS_WORK_RELATIONSHIP_CHECKS=Object.freeze([
{name:"task_project_tenant",sql:`SELECT count(*)::bigint AS count FROM work_tasks t JOIN work_projects p ON p.id=t.project_id WHERE t.organization_id<>p.organization_id`},
{name:"task_parent_tenant",sql:`SELECT count(*)::bigint AS count FROM work_tasks t JOIN work_tasks p ON p.id=t.parent_task_id WHERE t.organization_id<>p.organization_id OR t.id=p.id`},
{name:"task_assignee_membership",sql:`SELECT count(*)::bigint AS count FROM work_task_assignees a JOIN work_tasks t ON t.id=a.task_id LEFT JOIN memberships m ON m.organization_id=t.organization_id AND m.user_id=a.user_id WHERE m.user_id IS NULL`},
{name:"comment_tenant",sql:`SELECT count(*)::bigint AS count FROM work_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.organization_id<>t.organization_id`},
{name:"time_tenant",sql:`SELECT count(*)::bigint AS count FROM work_time_entries e JOIN work_tasks t ON t.id=e.task_id WHERE e.organization_id<>t.organization_id`},
{name:"notification_tenant",sql:`SELECT count(*)::bigint AS count FROM work_notifications n LEFT JOIN memberships m ON m.organization_id=n.organization_id AND m.user_id=n.user_id WHERE m.user_id IS NULL`},
{name:"chat_task_tenant",sql:`SELECT count(*)::bigint AS count FROM work_chat_threads c JOIN work_tasks t ON t.id=c.task_id WHERE c.organization_id<>t.organization_id`},
{name:"chat_message_tenant",sql:`SELECT count(*)::bigint AS count FROM work_chat_messages m JOIN work_chat_threads t ON t.id=m.thread_id WHERE m.organization_id<>t.organization_id`},
{name:"duplicate_reminder_keys",sql:`SELECT count(*)::bigint AS count FROM (SELECT reminder_key FROM work_task_reminders GROUP BY reminder_key HAVING count(*)>1) d`}
]);