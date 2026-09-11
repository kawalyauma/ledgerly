export async function ensureFinanceCoreIntegritySchema(database) {
  await database.query(`
    ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
    CREATE INDEX IF NOT EXISTS payment_allocations_active_payment_idx
      ON payment_allocations (organization_id,payment_id) WHERE reversed_at IS NULL;
  `);
}
