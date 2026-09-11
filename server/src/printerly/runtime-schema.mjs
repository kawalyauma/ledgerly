export async function ensurePrinterlyRuntimeSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS prn_dispatch_outbox (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
      event_type text NOT NULL CHECK(event_type IN ('dispatch','released','completed','failed','cancelled')),
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','dead')),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
      available_at timestamptz NOT NULL DEFAULT now(),
      lease_expires_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,job_id,event_type)
    );
    ALTER TABLE prn_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
    CREATE INDEX IF NOT EXISTS prn_dispatch_outbox_pending_idx
      ON prn_dispatch_outbox(status,available_at,created_at);
    CREATE INDEX IF NOT EXISTS prn_dispatch_outbox_org_idx
      ON prn_dispatch_outbox(organization_id,status,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS prn_jobs_selfhost_idempotency_idx
      ON prn_jobs(organization_id,idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS prn_jobs_selfhost_request_idx
      ON prn_jobs(organization_id,source_reference)
      WHERE source_module='selfhost-api' AND source_reference IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS prn_release_credentials_active_job_idx
      ON prn_release_credentials(organization_id,job_id)
      WHERE used_at IS NULL AND revoked_at IS NULL;
  `);
}
