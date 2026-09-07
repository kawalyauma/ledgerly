PRAGMA foreign_keys = ON;

-- Discipline evidence needs protected school file access for roles that can manage cases.
-- Existing schools receive these permissions without having to rerun IAM bootstrap.
INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.files:read', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','class_teacher','warden');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.files:write', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','class_teacher','warden');
