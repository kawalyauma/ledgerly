CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE SCHEMA IF NOT EXISTS ledgerly_meta;

CREATE TABLE IF NOT EXISTS ledgerly_meta.runtime_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ledgerly_meta.runtime_metadata (key, value)
VALUES (
  'deployment',
  jsonb_build_object(
    'mode', 'self_hosted',
    'schema_version', 1,
    'created_at', now()
  )
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
