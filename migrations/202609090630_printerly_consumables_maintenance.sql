-- Printerly v1.11: consumables inventory and preventive maintenance.
CREATE TABLE IF NOT EXISTS prn_consumables (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  printer_id TEXT REFERENCES prn_printers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('toner','ink','drum','paper','waste','other')),
  name TEXT NOT NULL,
  sku TEXT,
  marker_name TEXT,
  color TEXT,
  unit TEXT NOT NULL DEFAULT 'unit',
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK(reorder_level >= 0),
  target_stock INTEGER NOT NULL DEFAULT 0 CHECK(target_stock >= 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  marker_low_percent INTEGER NOT NULL DEFAULT 15 CHECK(marker_low_percent BETWEEN 1 AND 99),
  last_marker_percent INTEGER CHECK(last_marker_percent BETWEEN 0 AND 100),
  last_marker_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_consumables_org ON prn_consumables(organization_id,active,type,name);
CREATE INDEX IF NOT EXISTS idx_prn_consumables_printer ON prn_consumables(organization_id,printer_id,active);

CREATE TABLE IF NOT EXISTS prn_consumable_movements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','restock','usage','adjustment','writeoff')),
  quantity_delta INTEGER NOT NULL CHECK(quantity_delta <> 0),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
  reference TEXT,
  notes TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_consumable_movements_item ON prn_consumable_movements(organization_id,consumable_id,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_maintenance_profiles (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  printer_id TEXT NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
  service_interval_impressions INTEGER NOT NULL DEFAULT 50000 CHECK(service_interval_impressions BETWEEN 0 AND 1000000000),
  service_interval_days INTEGER NOT NULL DEFAULT 180 CHECK(service_interval_days BETWEEN 0 AND 3650),
  warning_impressions INTEGER NOT NULL DEFAULT 5000 CHECK(warning_impressions BETWEEN 0 AND 100000000),
  warning_days INTEGER NOT NULL DEFAULT 14 CHECK(warning_days BETWEEN 0 AND 365),
  last_service_at TEXT,
  last_service_impressions INTEGER NOT NULL DEFAULT 0 CHECK(last_service_impressions >= 0),
  next_due_at TEXT,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,printer_id)
);

CREATE TABLE IF NOT EXISTS prn_maintenance_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  printer_id TEXT NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('service','repair','cleaning','inspection','parts')),
  notes TEXT NOT NULL DEFAULT '',
  technician TEXT,
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(cost_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  impressions_at_event INTEGER NOT NULL DEFAULT 0 CHECK(impressions_at_event >= 0),
  performed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_maintenance_events_printer ON prn_maintenance_events(organization_id,printer_id,performed_at DESC);

UPDATE app_modules
SET version='1.11.0',
    description='Secure remote print and scan operations with governance, privacy controls, consumables inventory and preventive printer maintenance.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
