import { recordValidation } from "./bookkeeping.mjs";

export const AUTH_CORE_RELATIONSHIP_CHECKS = Object.freeze([
  ["memberships.organization", `SELECT count(*)::bigint AS count FROM memberships x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["memberships.user", `SELECT count(*)::bigint AS count FROM memberships x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL`],
  ["accounts.organization", `SELECT count(*)::bigint AS count FROM accounts x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["api_keys.organization", `SELECT count(*)::bigint AS count FROM api_keys x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["sessions.organization", `SELECT count(*)::bigint AS count FROM sessions x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["sessions.user", `SELECT count(*)::bigint AS count FROM sessions x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL`],
  ["school_user_profiles.organization", `SELECT count(*)::bigint AS count FROM school_user_profiles x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["school_user_profiles.user", `SELECT count(*)::bigint AS count FROM school_user_profiles x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL`],
  ["school_login_aliases.organization", `SELECT count(*)::bigint AS count FROM school_login_aliases x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["school_login_aliases.user", `SELECT count(*)::bigint AS count FROM school_login_aliases x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL`],
  ["school_user_mfa.organization", `SELECT count(*)::bigint AS count FROM school_user_mfa x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL`],
  ["school_user_mfa.user", `SELECT count(*)::bigint AS count FROM school_user_mfa x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL`],
  ["school_login_events.organization", `SELECT count(*)::bigint AS count FROM school_login_events x LEFT JOIN organizations p ON p.id=x.organization_id WHERE x.organization_id IS NOT NULL AND p.id IS NULL`],
  ["school_login_events.user", `SELECT count(*)::bigint AS count FROM school_login_events x LEFT JOIN users p ON p.id=x.user_id WHERE x.user_id IS NOT NULL AND p.id IS NULL`],
]);

export async function validateRelationshipChecks(database, runId, checks) {
  let failed = 0;
  for (const [name, sql] of checks) {
    const result = await database.query(sql);
    const count = Number(result.rows[0]?.count ?? 0);
    const status = count === 0 ? "passed" : "failed";
    if (count !== 0) failed += 1;
    await recordValidation(database, runId, {
      checkName: `relationship:${name}`,
      status,
      expected: { orphanCount: 0 },
      actual: { orphanCount: count },
    });
  }
  return { ok: failed === 0, failedChecks: failed, totalChecks: checks.length };
}

export function validateRelationships(database, runId) {
  return validateRelationshipChecks(database, runId, AUTH_CORE_RELATIONSHIP_CHECKS);
}

export async function validateTableCounts(database, source, runId, table) {
  const sourceCount = await source.count(table.name);
  const result = await database.query(`SELECT count(*)::bigint AS count FROM "${table.name}"`);
  const targetCount = Number(result.rows[0]?.count ?? 0);
  const status = sourceCount === targetCount ? "passed" : "failed";
  await recordValidation(database, runId, {
    tableName: table.name,
    checkName: "row_count",
    status,
    expected: { sourceCount },
    actual: { targetCount },
  });
  return { ok: status === "passed", sourceCount, targetCount };
}
