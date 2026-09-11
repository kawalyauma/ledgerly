export async function ensurePrinterlySchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS prn_nodes (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, location text, status text NOT NULL DEFAULT 'pairing', pairing_code_hash text,
      pairing_expires_at timestamptz, token_hash text, last_seen_at timestamptz, version text, revoked_at timestamptz,
      created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS prn_nodes_org_idx ON prn_nodes(organization_id,status);
    CREATE UNIQUE INDEX IF NOT EXISTS prn_nodes_pairing_idx ON prn_nodes(pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS prn_nodes_token_idx ON prn_nodes(token_hash) WHERE token_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS prn_printers (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      node_id text NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE, name text NOT NULL, system_name text NOT NULL,
      location text, status text NOT NULL DEFAULT 'unknown', capabilities_json text, last_seen_at timestamptz,
      health_status text NOT NULL DEFAULT 'unknown', state_reasons_json text NOT NULL DEFAULT '[]',
      marker_levels_json text NOT NULL DEFAULT '[]', health_message text, last_health_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(node_id,system_name)
    );
    CREATE INDEX IF NOT EXISTS prn_printers_org_idx ON prn_printers(organization_id,node_id,status);

    CREATE TABLE IF NOT EXISTS prn_printer_pools (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL,
      description text, strategy text NOT NULL DEFAULT 'least_loaded' CHECK(strategy IN ('least_loaded','priority_load')),
      requirements_json text NOT NULL DEFAULT '{}', default_auto boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
      created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS prn_printer_pools_org_idx ON prn_printer_pools(organization_id,active,name);
    CREATE UNIQUE INDEX IF NOT EXISTS prn_printer_pools_default_idx ON prn_printer_pools(organization_id) WHERE active AND default_auto;

    CREATE TABLE IF NOT EXISTS prn_printer_pool_members (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      pool_id text NOT NULL REFERENCES prn_printer_pools(id) ON DELETE CASCADE,
      printer_id text NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
      priority integer NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 1000), enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(pool_id,printer_id)
    );

    CREATE TABLE IF NOT EXISTS prn_jobs (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_number text NOT NULL, title text NOT NULL, document_url text NOT NULL, document_mime text NOT NULL DEFAULT 'application/pdf',
      document_sha256 text, printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL, node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'queued', priority text NOT NULL DEFAULT 'normal', copies integer NOT NULL DEFAULT 1 CHECK(copies>0),
      page_size text NOT NULL DEFAULT 'A4', color_mode text NOT NULL DEFAULT 'monochrome', duplex boolean NOT NULL DEFAULT false,
      secure_release boolean NOT NULL DEFAULT false, total_sheets integer, claim_token text, claim_expires_at timestamptz,
      released_at timestamptz, error_message text, created_by text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, document_id text,
      source_module text, source_reference text, charge_project_id text, charge_department_type text, charge_department_id text,
      estimated_pages integer, estimated_impressions integer, estimated_sheets integer, actual_impressions integer, actual_sheets integer,
      estimated_cost_minor bigint, actual_cost_minor bigint, route_pool_id text REFERENCES prn_printer_pools(id) ON DELETE SET NULL,
      route_strategy text, route_reason text, routed_at timestamptz, UNIQUE(organization_id,job_number)
    );
    CREATE INDEX IF NOT EXISTS prn_jobs_queue_idx ON prn_jobs(organization_id,status,priority,created_at);
    CREATE INDEX IF NOT EXISTS prn_jobs_node_idx ON prn_jobs(node_id,status);
    CREATE INDEX IF NOT EXISTS prn_jobs_route_pool_idx ON prn_jobs(organization_id,route_pool_id,status,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS prn_jobs_batch_source_idx ON prn_jobs(organization_id,source_reference) WHERE source_module='printerly-batch' AND source_reference IS NOT NULL;

    CREATE TABLE IF NOT EXISTS prn_job_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE, event_type text NOT NULL, actor_id text,
      details_json text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS prn_job_events_job_idx ON prn_job_events(organization_id,job_id,created_at);

    CREATE TABLE IF NOT EXISTS prn_documents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      object_key text NOT NULL UNIQUE, original_name text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0),
      checksum_sha256 text NOT NULL, status text NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','attached','deleted')),
      uploaded_by text, job_id text REFERENCES prn_jobs(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
      attached_at timestamptz, deleted_at timestamptz, retention_purged_at timestamptz, retention_purge_reason text
    );
    CREATE INDEX IF NOT EXISTS prn_documents_org_status_idx ON prn_documents(organization_id,status,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS prn_documents_job_idx ON prn_documents(job_id) WHERE job_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS prn_jobs_document_idx ON prn_jobs(document_id) WHERE document_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS prn_cost_profiles (
      organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE, currency text NOT NULL DEFAULT 'UGX',
      paper_cost_minor bigint NOT NULL DEFAULT 0 CHECK(paper_cost_minor>=0), bw_toner_cost_minor bigint NOT NULL DEFAULT 0 CHECK(bw_toner_cost_minor>=0),
      color_toner_cost_minor bigint NOT NULL DEFAULT 0 CHECK(color_toner_cost_minor>=0), maintenance_cost_minor bigint NOT NULL DEFAULT 0 CHECK(maintenance_cost_minor>=0),
      electricity_cost_minor bigint NOT NULL DEFAULT 0 CHECK(electricity_cost_minor>=0), expense_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      offset_account_id text REFERENCES accounts(id) ON DELETE SET NULL, auto_post_accounting boolean NOT NULL DEFAULT false,
      updated_by text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_cost_ledger (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE, project_id text, department_type text, department_id text,
      impressions integer NOT NULL CHECK(impressions>=0), sheets integer NOT NULL CHECK(sheets>=0), paper_cost_minor bigint NOT NULL CHECK(paper_cost_minor>=0),
      toner_cost_minor bigint NOT NULL CHECK(toner_cost_minor>=0), maintenance_cost_minor bigint NOT NULL CHECK(maintenance_cost_minor>=0),
      electricity_cost_minor bigint NOT NULL CHECK(electricity_cost_minor>=0), total_cost_minor bigint NOT NULL CHECK(total_cost_minor>=0),
      currency text NOT NULL, calculation_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,job_id)
    );
    CREATE TABLE IF NOT EXISTS prn_cost_postings (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE, cost_ledger_id text NOT NULL REFERENCES prn_cost_ledger(id) ON DELETE RESTRICT,
      journal_entry_id text NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT, posted_by text, posted_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,job_id), UNIQUE(organization_id,journal_entry_id)
    );

    CREATE TABLE IF NOT EXISTS prn_alerts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      fingerprint text NOT NULL, event_type text NOT NULL, severity text NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
      title text NOT NULL, body text NOT NULL, entity_type text, entity_id text, details_json text NOT NULL DEFAULT '{}',
      acknowledged_by text REFERENCES users(id) ON DELETE SET NULL, acknowledged_at timestamptz, resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prn_alert_active_fingerprint_idx ON prn_alerts(organization_id,fingerprint) WHERE resolved_at IS NULL;
    CREATE TABLE IF NOT EXISTS prn_alert_subscriptions (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type text NOT NULL, enabled boolean NOT NULL DEFAULT true, email boolean NOT NULL DEFAULT true, sms boolean NOT NULL DEFAULT false,
      whatsapp boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,user_id,event_type)
    );

    CREATE TABLE IF NOT EXISTS prn_scanners (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      node_id text NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE, name text NOT NULL, system_name text NOT NULL,
      status text NOT NULL DEFAULT 'unknown', capabilities_json text NOT NULL DEFAULT '{}', last_seen_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(node_id,system_name)
    );
    CREATE TABLE IF NOT EXISTS prn_scan_jobs (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, scan_number text NOT NULL, title text NOT NULL,
      scanner_id text REFERENCES prn_scanners(id) ON DELETE SET NULL, node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','scanning','uploading','completed','failed','cancelled')),
      source text NOT NULL DEFAULT 'flatbed' CHECK(source IN ('flatbed','adf')), color_mode text NOT NULL DEFAULT 'color' CHECK(color_mode IN ('color','gray','lineart')),
      resolution_dpi integer NOT NULL DEFAULT 300 CHECK(resolution_dpi BETWEEN 75 AND 1200), page_size text NOT NULL DEFAULT 'A4',
      output_format text NOT NULL DEFAULT 'pdf' CHECK(output_format IN ('pdf','png','jpeg')), target_type text NOT NULL DEFAULT 'inbox' CHECK(target_type IN ('inbox','student','staff','module')),
      target_module text, target_id text, notes text, claim_token text, claim_expires_at timestamptz, document_id text, error_message text,
      created_by text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz, UNIQUE(organization_id,scan_number)
    );
    CREATE TABLE IF NOT EXISTS prn_scan_documents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      scan_job_id text NOT NULL REFERENCES prn_scan_jobs(id) ON DELETE CASCADE, object_key text NOT NULL UNIQUE, original_name text NOT NULL,
      mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0), checksum_sha256 text NOT NULL, target_type text NOT NULL,
      target_module text, target_id text, school_file_id text, created_at timestamptz NOT NULL DEFAULT now(),
      retention_purged_at timestamptz, retention_purge_reason text, UNIQUE(organization_id,scan_job_id)
    );
    CREATE TABLE IF NOT EXISTS prn_scan_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      scan_job_id text NOT NULL REFERENCES prn_scan_jobs(id) ON DELETE CASCADE, event_type text NOT NULL, actor_id text,
      details_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS prn_quotas (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL,
      scope_type text NOT NULL CHECK(scope_type IN ('organization','user','finance_department','school_department','project')),
      scope_id text, scope_key text NOT NULL, mode text NOT NULL DEFAULT 'soft' CHECK(mode IN ('soft','hard')),
      max_impressions bigint NOT NULL DEFAULT 0 CHECK(max_impressions>=0), max_sheets bigint NOT NULL DEFAULT 0 CHECK(max_sheets>=0),
      max_cost_minor bigint NOT NULL DEFAULT 0 CHECK(max_cost_minor>=0), warning_percent integer NOT NULL DEFAULT 80 CHECK(warning_percent BETWEEN 1 AND 100),
      active boolean NOT NULL DEFAULT true, created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prn_quotas_scope_idx ON prn_quotas(organization_id,scope_key) WHERE active;
    CREATE TABLE IF NOT EXISTS prn_quota_periods (
      quota_id text NOT NULL REFERENCES prn_quotas(id) ON DELETE CASCADE, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      period_key text NOT NULL, reserved_impressions bigint NOT NULL DEFAULT 0 CHECK(reserved_impressions>=0), reserved_sheets bigint NOT NULL DEFAULT 0 CHECK(reserved_sheets>=0),
      reserved_cost_minor bigint NOT NULL DEFAULT 0 CHECK(reserved_cost_minor>=0), consumed_impressions bigint NOT NULL DEFAULT 0 CHECK(consumed_impressions>=0),
      consumed_sheets bigint NOT NULL DEFAULT 0 CHECK(consumed_sheets>=0), consumed_cost_minor bigint NOT NULL DEFAULT 0 CHECK(consumed_cost_minor>=0),
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(quota_id,period_key)
    );
    CREATE TABLE IF NOT EXISTS prn_quota_reservations (
      id text PRIMARY KEY, group_id text NOT NULL, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      quota_id text NOT NULL REFERENCES prn_quotas(id) ON DELETE CASCADE, period_key text NOT NULL, job_id text REFERENCES prn_jobs(id) ON DELETE SET NULL,
      reserved_impressions bigint NOT NULL CHECK(reserved_impressions>=0), reserved_sheets bigint NOT NULL CHECK(reserved_sheets>=0),
      reserved_cost_minor bigint NOT NULL CHECK(reserved_cost_minor>=0), actual_impressions bigint, actual_sheets bigint, actual_cost_minor bigint,
      status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released')),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(quota_id,job_id)
    );

    CREATE TABLE IF NOT EXISTS prn_print_rules (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL, description text,
      active boolean NOT NULL DEFAULT true, priority integer NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 1000), match_json text NOT NULL DEFAULT '{}',
      action_json text NOT NULL DEFAULT '{}', created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_approvals (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE, rule_ids_json text NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      requested_by text REFERENCES users(id) ON DELETE SET NULL, requested_at timestamptz NOT NULL DEFAULT now(),
      approver_roles_json text NOT NULL DEFAULT '["owner","admin"]', approver_user_ids_json text NOT NULL DEFAULT '[]', allow_self_approval boolean NOT NULL DEFAULT false,
      decided_by text REFERENCES users(id) ON DELETE SET NULL, decided_at timestamptz, decision_note text, decision_nonce text, UNIQUE(organization_id,job_id)
    );

    CREATE TABLE IF NOT EXISTS prn_batches (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, batch_number text NOT NULL, name text NOT NULL,
      description text, status text NOT NULL DEFAULT 'ready', defaults_json text NOT NULL DEFAULT '{}', scheduled_at timestamptz,
      creator_role text, creator_scopes_json text NOT NULL DEFAULT '[]', last_error text, created_by text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
      UNIQUE(organization_id,batch_number)
    );
    CREATE TABLE IF NOT EXISTS prn_batch_items (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      batch_id text NOT NULL REFERENCES prn_batches(id) ON DELETE CASCADE, document_id text NOT NULL REFERENCES prn_documents(id) ON DELETE RESTRICT,
      title text NOT NULL, sort_order integer NOT NULL DEFAULT 0, settings_json text NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending',
      job_id text REFERENCES prn_jobs(id) ON DELETE SET NULL, error_message text, claim_token text, claim_expires_at timestamptz, attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(batch_id,document_id)
    );

    CREATE TABLE IF NOT EXISTS prn_release_credentials (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
      issued_by text REFERENCES users(id) ON DELETE SET NULL, pin_digest text NOT NULL, token_digest text NOT NULL, attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts>0), locked_at timestamptz, expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
      used_node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL, used_printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_release_attempt_log (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      node_id text NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE, credential_id text REFERENCES prn_release_credentials(id) ON DELETE SET NULL,
      success boolean NOT NULL DEFAULT false, failure_code text, created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS prn_retention_policies (
      organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT true,
      staged_hours integer NOT NULL DEFAULT 24 CHECK(staged_hours BETWEEN 1 AND 720), completed_print_days integer NOT NULL DEFAULT 7 CHECK(completed_print_days BETWEEN 0 AND 3650),
      failed_print_days integer NOT NULL DEFAULT 7 CHECK(failed_print_days BETWEEN 0 AND 3650), secure_print_minutes integer NOT NULL DEFAULT 10 CHECK(secure_print_minutes BETWEEN 0 AND 10080),
      scan_inbox_days integer NOT NULL DEFAULT 30 CHECK(scan_inbox_days BETWEEN 0 AND 3650), scan_routed_days integer NOT NULL DEFAULT 7 CHECK(scan_routed_days BETWEEN 0 AND 3650),
      updated_by text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_retention_holds (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      entity_type text NOT NULL CHECK(entity_type IN ('print_job','scan_job','print_document','scan_document')), entity_id text NOT NULL, reason text NOT NULL,
      held_by text REFERENCES users(id) ON DELETE SET NULL, held_at timestamptz NOT NULL DEFAULT now(), released_by text REFERENCES users(id) ON DELETE SET NULL, released_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prn_retention_holds_active_idx ON prn_retention_holds(organization_id,entity_type,entity_id) WHERE released_at IS NULL;
    CREATE TABLE IF NOT EXISTS prn_retention_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, event_type text NOT NULL,
      entity_type text, entity_id text, object_key text, actor_id text REFERENCES users(id) ON DELETE SET NULL,
      details_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS prn_consumables (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, printer_id text REFERENCES prn_printers(id) ON DELETE CASCADE,
      type text NOT NULL CHECK(type IN ('toner','ink','drum','paper','waste','other')), name text NOT NULL, sku text, marker_name text, color text,
      unit text NOT NULL DEFAULT 'unit', on_hand integer NOT NULL DEFAULT 0 CHECK(on_hand>=0), reorder_level integer NOT NULL DEFAULT 0 CHECK(reorder_level>=0),
      target_stock integer NOT NULL DEFAULT 0 CHECK(target_stock>=0), unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0), currency text NOT NULL DEFAULT 'UGX',
      marker_low_percent integer NOT NULL DEFAULT 15 CHECK(marker_low_percent BETWEEN 1 AND 99), last_marker_percent integer CHECK(last_marker_percent BETWEEN 0 AND 100),
      last_marker_at timestamptz, active boolean NOT NULL DEFAULT true, created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_consumable_movements (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
      movement_type text NOT NULL CHECK(movement_type IN ('opening','restock','usage','adjustment','writeoff')),
      quantity_delta integer NOT NULL CHECK(quantity_delta<>0), balance_after integer NOT NULL CHECK(balance_after>=0), unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0),
      reference text, notes text, actor_id text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_maintenance_profiles (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, printer_id text NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
      service_interval_impressions bigint NOT NULL DEFAULT 50000 CHECK(service_interval_impressions BETWEEN 0 AND 1000000000),
      service_interval_days integer NOT NULL DEFAULT 180 CHECK(service_interval_days BETWEEN 0 AND 3650), warning_impressions bigint NOT NULL DEFAULT 5000 CHECK(warning_impressions BETWEEN 0 AND 100000000),
      warning_days integer NOT NULL DEFAULT 14 CHECK(warning_days BETWEEN 0 AND 365), last_service_at timestamptz, last_service_impressions bigint NOT NULL DEFAULT 0 CHECK(last_service_impressions>=0),
      next_due_at timestamptz, updated_by text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(organization_id,printer_id)
    );
    CREATE TABLE IF NOT EXISTS prn_maintenance_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, printer_id text NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
      event_type text NOT NULL CHECK(event_type IN ('service','repair','cleaning','inspection','parts')), notes text NOT NULL DEFAULT '', technician text,
      cost_minor bigint NOT NULL DEFAULT 0 CHECK(cost_minor>=0), currency text NOT NULL DEFAULT 'UGX', impressions_at_event bigint NOT NULL DEFAULT 0 CHECK(impressions_at_event>=0),
      performed_at timestamptz NOT NULL DEFAULT now(), created_by text REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS prn_suppliers (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, code text, name text NOT NULL,
      contact_name text, email text, phone text, address text, lead_time_days integer NOT NULL DEFAULT 0 CHECK(lead_time_days BETWEEN 0 AND 3650),
      payment_terms text, active boolean NOT NULL DEFAULT true, created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prn_suppliers_code_idx ON prn_suppliers(organization_id,code) WHERE code IS NOT NULL AND active;
    CREATE TABLE IF NOT EXISTS prn_supplier_catalog (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      supplier_id text NOT NULL REFERENCES prn_suppliers(id) ON DELETE CASCADE, consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
      supplier_sku text, unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0), currency text NOT NULL DEFAULT 'UGX',
      min_order_qty integer NOT NULL DEFAULT 1 CHECK(min_order_qty>=1), preferred boolean NOT NULL DEFAULT false, notes text, last_quoted_at timestamptz,
      created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,supplier_id,consumable_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prn_supplier_catalog_preferred_idx ON prn_supplier_catalog(organization_id,consumable_id) WHERE preferred;
    CREATE TABLE IF NOT EXISTS prn_procurement_settings (
      organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE, auto_draft_reorders boolean NOT NULL DEFAULT false,
      updated_by text REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_purchase_requests (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, request_number text NOT NULL,
      supplier_id text NOT NULL REFERENCES prn_suppliers(id) ON DELETE RESTRICT, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','ordered','partially_received','received','rejected','cancelled')),
      currency text NOT NULL DEFAULT 'UGX', subtotal_minor bigint NOT NULL DEFAULT 0 CHECK(subtotal_minor>=0), notes text, expected_at timestamptz,
      requested_by text REFERENCES users(id) ON DELETE SET NULL, approved_by text REFERENCES users(id) ON DELETE SET NULL, approved_at timestamptz,
      rejection_reason text, auto_generated boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,request_number)
    );
    CREATE TABLE IF NOT EXISTS prn_purchase_request_lines (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      request_id text NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE, consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE RESTRICT,
      description text NOT NULL, quantity_requested integer NOT NULL CHECK(quantity_requested>0), quantity_received integer NOT NULL DEFAULT 0 CHECK(quantity_received>=0 AND quantity_received<=quantity_requested),
      unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0), supplier_sku text, notes text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,request_id,consumable_id)
    );
    CREATE TABLE IF NOT EXISTS prn_replenishment_claims (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE CASCADE,
      request_id text NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,consumable_id)
    );
    CREATE TABLE IF NOT EXISTS prn_purchase_request_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      request_id text NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE CASCADE, event_type text NOT NULL, actor_id text REFERENCES users(id) ON DELETE SET NULL,
      details_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS prn_purchase_receipts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      request_id text NOT NULL REFERENCES prn_purchase_requests(id) ON DELETE RESTRICT, receipt_number text NOT NULL, delivery_note text, invoice_reference text,
      notes text, received_by text REFERENCES users(id) ON DELETE SET NULL, received_at timestamptz NOT NULL DEFAULT now(), total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor>=0), UNIQUE(organization_id,receipt_number)
    );
    CREATE TABLE IF NOT EXISTS prn_purchase_receipt_lines (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      receipt_id text NOT NULL REFERENCES prn_purchase_receipts(id) ON DELETE CASCADE, request_line_id text NOT NULL REFERENCES prn_purchase_request_lines(id) ON DELETE RESTRICT,
      consumable_id text NOT NULL REFERENCES prn_consumables(id) ON DELETE RESTRICT, quantity integer NOT NULL CHECK(quantity>0), unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,receipt_id,request_line_id)
    );

    CREATE TABLE IF NOT EXISTS prn_service_settings (
      organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE, auto_create_from_alerts boolean NOT NULL DEFAULT true,
      auto_resolve_recovered boolean NOT NULL DEFAULT true, p1_response_minutes integer NOT NULL DEFAULT 30, p1_resolution_minutes integer NOT NULL DEFAULT 240,
      p2_response_minutes integer NOT NULL DEFAULT 120, p2_resolution_minutes integer NOT NULL DEFAULT 480, p3_response_minutes integer NOT NULL DEFAULT 480,
      p3_resolution_minutes integer NOT NULL DEFAULT 1440, p4_response_minutes integer NOT NULL DEFAULT 1440, p4_resolution_minutes integer NOT NULL DEFAULT 4320,
      updated_by text REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(p1_resolution_minutes>=p1_response_minutes), CHECK(p2_resolution_minutes>=p2_response_minutes), CHECK(p3_resolution_minutes>=p3_response_minutes), CHECK(p4_resolution_minutes>=p4_response_minutes)
    );
    CREATE TABLE IF NOT EXISTS prn_service_tickets (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, ticket_number text NOT NULL,
      source_type text NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','alert','maintenance')), source_alert_id text REFERENCES prn_alerts(id) ON DELETE SET NULL,
      category text NOT NULL DEFAULT 'other' CHECK(category IN ('printer','node','scanner','scan_job','print_job','maintenance','supplies','other')),
      priority text NOT NULL DEFAULT 'p3' CHECK(priority IN ('p1','p2','p3','p4')), status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','assigned','in_progress','waiting','resolved','closed','cancelled')),
      title text NOT NULL, description text NOT NULL DEFAULT '', printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL, node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
      scanner_id text REFERENCES prn_scanners(id) ON DELETE SET NULL, assignee_id text REFERENCES users(id) ON DELETE SET NULL, created_by text REFERENCES users(id) ON DELETE SET NULL,
      response_due_at timestamptz NOT NULL, resolution_due_at timestamptz NOT NULL, first_responded_at timestamptz, response_breached_at timestamptz,
      resolution_breached_at timestamptz, scheduled_start_at timestamptz, scheduled_end_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
      resolution_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,ticket_number)
    );
    CREATE TABLE IF NOT EXISTS prn_service_ticket_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      ticket_id text NOT NULL REFERENCES prn_service_tickets(id) ON DELETE CASCADE, event_type text NOT NULL, actor_id text REFERENCES users(id) ON DELETE SET NULL,
      notes text, details_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS prn_service_ticket_queue_idx ON prn_service_tickets(organization_id,status,priority,resolution_due_at);
    CREATE INDEX IF NOT EXISTS prn_purchase_requests_org_idx ON prn_purchase_requests(organization_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS prn_consumables_org_idx ON prn_consumables(organization_id,active,type,name);
    CREATE INDEX IF NOT EXISTS prn_batches_org_status_idx ON prn_batches(organization_id,status,scheduled_at,created_at DESC);
    CREATE INDEX IF NOT EXISTS prn_approvals_org_status_idx ON prn_approvals(organization_id,status,requested_at DESC);
  `);
}
