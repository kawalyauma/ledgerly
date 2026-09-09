-- Printerly v1.12: procurement and safe automatic replenishment.
CREATE TABLE IF NOT EXISTS prn_suppliers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_time_days BETWEEN 0 AND 3650),
  payment_terms TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_suppliers_code ON prn_suppliers(organization_id,code) WHERE code IS NOT NULL AND active=1;
CREATE INDEX IF NOT EXISTS idx_prn_suppliers_org ON prn_suppliers(organization_id,active,name);

CREATE TABLE IF NOT EXISTS prn_supplier_catalog (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES prn_suppliers(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
  supplier_sku TEXT,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  min_order_qty INTEGER NOT NULL DEFAULT 1 CHECK(min_order_qty >= 1),
  preferred INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  last_quoted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,supplier_id,consumable_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_catalog_consumable ON prn_supplier_catalog(organization_id,consumable_id,preferred,supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_catalog_preferred ON prn_supplier_catalog(organization_id,consumable_id) WHERE preferred=1;

CREATE TABLE IF NOT EXISTS prn_procurement_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  auto_draft_reorders INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prn_purchase_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES prn_suppliers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','ordered','partially_received','received','rejected','cancelled')),
  currency TEXT NOT NULL DEFAULT 'UGX',
  subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_minor >= 0),
  notes TEXT,
  expected_at TEXT,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejection_reason TEXT,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,request_number)
);
CREATE INDEX IF NOT EXISTS idx_prn_purchase_requests_org ON prn_purchase_requests(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prn_purchase_requests_supplier ON prn_purchase_requests(organization_id,supplier_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_purchase_request_lines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL REFERENCES prn_consumables(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity_requested INTEGER NOT NULL CHECK(quantity_requested > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK(quantity_received >= 0 AND quantity_received <= quantity_requested),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
  supplier_sku TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,request_id,consumable_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_purchase_lines_request ON prn_purchase_request_lines(organization_id,request_id,created_at);
CREATE INDEX IF NOT EXISTS idx_prn_purchase_lines_consumable ON prn_purchase_request_lines(organization_id,consumable_id,request_id);

CREATE TABLE IF NOT EXISTS prn_replenishment_claims (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,consumable_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_replenishment_claim_request ON prn_replenishment_claims(organization_id,request_id);

CREATE TABLE IF NOT EXISTS prn_purchase_request_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_purchase_events_request ON prn_purchase_request_events(organization_id,request_id,created_at);

CREATE TABLE IF NOT EXISTS prn_purchase_receipts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL,
  delivery_note TEXT,
  invoice_reference TEXT,
  notes TEXT,
  received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_minor INTEGER NOT NULL DEFAULT 0 CHECK(total_minor >= 0),
  UNIQUE(organization_id,receipt_number)
);
CREATE INDEX IF NOT EXISTS idx_prn_purchase_receipts_request ON prn_purchase_receipts(organization_id,request_id,received_at DESC);

CREATE TABLE IF NOT EXISTS prn_purchase_receipt_lines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES prn_purchase_receipts(id) ON DELETE CASCADE,
  request_line_id TEXT NOT NULL REFERENCES prn_purchase_request_lines(id) ON DELETE RESTRICT,
  consumable_id TEXT NOT NULL REFERENCES prn_consumables(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,receipt_id,request_line_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_receipt_lines_receipt ON prn_purchase_receipt_lines(organization_id,receipt_id);

-- Fail the whole receipt transaction if a concurrent receipt would over-receive a request line.
CREATE TRIGGER IF NOT EXISTS trg_prn_receipt_line_validate
BEFORE INSERT ON prn_purchase_receipt_lines
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1
    FROM prn_purchase_request_lines l
    JOIN prn_purchase_receipts r ON r.id=NEW.receipt_id AND r.organization_id=NEW.organization_id AND r.request_id=l.request_id
    JOIN prn_purchase_requests q ON q.id=l.request_id AND q.organization_id=l.organization_id
    WHERE l.id=NEW.request_line_id AND l.organization_id=NEW.organization_id
      AND l.consumable_id=NEW.consumable_id
      AND q.status IN ('approved','ordered','partially_received')
      AND l.quantity_received + NEW.quantity <= l.quantity_requested
  ) THEN RAISE(ABORT,'PRINTERLY_RECEIPT_CONFLICT') END;
END;

-- One receipt-line insert atomically updates the request line, stock ledger and request status.
CREATE TRIGGER IF NOT EXISTS trg_prn_receipt_line_apply
AFTER INSERT ON prn_purchase_receipt_lines
BEGIN
  UPDATE prn_purchase_request_lines
  SET quantity_received=quantity_received+NEW.quantity
  WHERE id=NEW.request_line_id AND organization_id=NEW.organization_id;

  UPDATE prn_consumables
  SET on_hand=on_hand+NEW.quantity,
      unit_cost_minor=CASE WHEN NEW.unit_cost_minor>0 THEN NEW.unit_cost_minor ELSE unit_cost_minor END,
      updated_by=(SELECT received_by FROM prn_purchase_receipts WHERE id=NEW.receipt_id),
      updated_at=CURRENT_TIMESTAMP
  WHERE id=NEW.consumable_id AND organization_id=NEW.organization_id AND active=1;

  INSERT INTO prn_consumable_movements(
    id,organization_id,consumable_id,movement_type,quantity_delta,balance_after,unit_cost_minor,reference,notes,actor_id
  )
  SELECT 'prnmove_'||lower(hex(randomblob(16))),NEW.organization_id,NEW.consumable_id,'restock',NEW.quantity,c.on_hand,
         NEW.unit_cost_minor,'purchase-receipt:'||NEW.receipt_id,'Received through Printerly procurement',r.received_by
  FROM prn_consumables c JOIN prn_purchase_receipts r ON r.id=NEW.receipt_id
  WHERE c.id=NEW.consumable_id AND c.organization_id=NEW.organization_id;

  UPDATE prn_purchase_requests
  SET status=CASE WHEN NOT EXISTS(
      SELECT 1 FROM prn_purchase_request_lines l
      WHERE l.organization_id=NEW.organization_id AND l.request_id=prn_purchase_requests.id AND l.quantity_received<l.quantity_requested
    ) THEN 'received' ELSE 'partially_received' END,
      updated_at=CURRENT_TIMESTAMP
  WHERE id=(SELECT request_id FROM prn_purchase_receipts WHERE id=NEW.receipt_id)
    AND organization_id=NEW.organization_id;

  DELETE FROM prn_replenishment_claims
  WHERE organization_id=NEW.organization_id
    AND request_id=(SELECT request_id FROM prn_purchase_receipts WHERE id=NEW.receipt_id)
    AND EXISTS(SELECT 1 FROM prn_purchase_requests r WHERE r.id=request_id AND r.organization_id=NEW.organization_id AND r.status='received');
END;

UPDATE app_modules
SET version='1.12.0',
    description='Secure remote print and scan operations with governance, privacy, supplies, preventive maintenance and replenishment procurement.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
