CREATE TABLE IF NOT EXISTS security_camera_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,name)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_groups_org ON security_camera_groups(organization_id,name);

CREATE TABLE IF NOT EXISTS security_camera_group_members (
  group_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id,camera_id),
  FOREIGN KEY(group_id) REFERENCES security_camera_groups(id) ON DELETE CASCADE,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_security_camera_group_members_camera ON security_camera_group_members(camera_id);

CREATE TABLE IF NOT EXISTS security_camera_wall_views (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  group_id TEXT,
  columns INTEGER NOT NULL DEFAULT 2,
  muted INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,name),
  FOREIGN KEY(group_id) REFERENCES security_camera_groups(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_security_camera_wall_views_org ON security_camera_wall_views(organization_id,name);

CREATE TABLE IF NOT EXISTS security_camera_wall_view_items (
  view_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(view_id,camera_id),
  FOREIGN KEY(view_id) REFERENCES security_camera_wall_views(id) ON DELETE CASCADE,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_camera_lifecycle (
  camera_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_security_camera_lifecycle_org_status ON security_camera_lifecycle(organization_id,lifecycle_status);
