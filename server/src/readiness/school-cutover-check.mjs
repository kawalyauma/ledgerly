import { loadConfig } from "../config.mjs";
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";

const required = [
  "organizations",
  "school_profiles",
  "school_branches",
  "school_academic_years",
  "school_terms",
  "school_class_levels",
  "school_classes",
  "school_streams",
  "school_subjects",
  "school_fee_categories",
  "school_roles",
  "school_settings",
  "school_admission_applications",
  "school_students",
  "school_guardians",
  "school_enrollments",
];

const config = loadConfig(process.env);
const database = await createPostgresDatabase(config.database);
try {
  const expressions = required.map((name, index) => `to_regclass('public.${name}') AS t${index}`).join(",");
  const result = await database.query(`SELECT ${expressions}`);
  const row = result.rows[0] ?? {};
  const missing = required.filter((_, index) => !row[`t${index}`]);

  const relationshipChecks = [];
  if (!missing.length) {
    const checks = await database.query(`SELECT
      (SELECT count(*) FROM school_terms t LEFT JOIN school_academic_years y ON y.id=t.academic_year_id AND y.organization_id=t.organization_id WHERE y.id IS NULL) AS orphan_terms,
      (SELECT count(*) FROM school_classes c LEFT JOIN school_class_levels l ON l.id=c.class_level_id AND l.organization_id=c.organization_id WHERE l.id IS NULL) AS orphan_classes,
      (SELECT count(*) FROM school_streams s LEFT JOIN school_classes c ON c.id=s.class_id AND c.organization_id=s.organization_id WHERE c.id IS NULL) AS orphan_streams,
      (SELECT count(*) FROM school_enrollments e LEFT JOIN school_students s ON s.id=e.student_id AND s.organization_id=e.organization_id WHERE s.id IS NULL) AS orphan_enrollments`);
    for (const [name, value] of Object.entries(checks.rows[0] ?? {})) {
      if (Number(value) !== 0) relationshipChecks.push({ name, count: Number(value) });
    }
  }

  const ok = missing.length === 0 && relationshipChecks.length === 0;
  console.log(JSON.stringify({ ok, provider: database.provider, requiredTables: required.length, missing, relationshipChecks }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await database.close();
}
