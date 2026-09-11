export async function ensureContactsSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type text NOT NULL, code text, name text NOT NULL, email text, tax_number text,
      payment_terms_days integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
      custom_fields text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      credit_limit_minor bigint NOT NULL DEFAULT 0, pricing_tier text, archived_at timestamptz,
      UNIQUE(id,organization_id)
    );
    CREATE INDEX IF NOT EXISTS contacts_org_type_idx ON contacts(organization_id,type,active);
    CREATE INDEX IF NOT EXISTS contacts_org_email_idx ON contacts(organization_id,lower(email)) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS contact_addresses (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, type text NOT NULL, line1 text NOT NULL, line2 text,
      city text, state text, postal_code text, country text NOT NULL, is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contact_addresses_contact_idx ON contact_addresses(organization_id,contact_id);
    CREATE TABLE IF NOT EXISTS contact_people (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, name text NOT NULL,
      email text, phone text, role text, is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contact_people_contact_idx ON contact_people(organization_id,contact_id);
    CREATE INDEX IF NOT EXISTS contact_people_phone_idx ON contact_people(organization_id,phone) WHERE phone IS NOT NULL;
    CREATE INDEX IF NOT EXISTS contact_people_email_idx ON contact_people(organization_id,lower(email)) WHERE email IS NOT NULL;
  `);
}
