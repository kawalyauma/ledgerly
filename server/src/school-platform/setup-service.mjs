import { randomUUID } from "node:crypto";

const SETUP_RESOURCES = Object.freeze({
  branches: {
    table: "school_branches", prefix: "sbr", order: "is_main DESC,name",
    columns: ["code","name","registration_number","phone","email","physical_address","postal_address","district_region","location_text","principal_name","is_main","active","metadata_json"],
    json: { metadata: "metadata_json" },
  },
  academicYears: {
    table: "school_academic_years", prefix: "acy", order: "starts_on DESC,name",
    columns: ["code","name","starts_on","ends_on","status","is_current"],
  },
  terms: {
    table: "school_terms", prefix: "trm", order: "academic_year_id,sequence_no,starts_on",
    columns: ["academic_year_id","code","name","sequence_no","starts_on","ends_on","status","is_current"],
  },
  departments: {
    table: "school_departments", prefix: "dep", order: "name",
    columns: ["campus_id","code","name","description","head_user_id","parent_id","active"],
  },
  classLevels: {
    table: "school_class_levels", prefix: "lvl", order: "sequence_no,name",
    columns: ["code","name","sequence_no","education_level","promotion_level_id","terminal","active"],
  },
  classes: {
    table: "school_classes", prefix: "cls", order: "academic_year_id,name",
    columns: ["academic_year_id","campus_id","class_level_id","department_id","code","name","capacity","class_teacher_user_id","active"],
  },
  streams: {
    table: "school_streams", prefix: "str", order: "class_id,name",
    columns: ["class_id","campus_id","code","name","capacity","class_teacher_user_id","active"],
  },
  subjects: {
    table: "school_subjects", prefix: "sub", order: "name",
    columns: ["department_id","code","name","short_name","subject_type","curriculum_code","pass_mark","max_mark","active","metadata_json"],
    json: { metadata: "metadata_json" },
  },
  classSubjects: {
    table: "school_class_subjects", prefix: "csub", order: "class_level_id,subject_id",
    columns: ["class_level_id","subject_id","academic_year_id","compulsory","periods_per_week","teacher_user_id","active"],
  },
  lessonPeriods: {
    table: "school_lesson_periods", prefix: "prd", order: "sequence_no,name",
    columns: ["campus_id","code","name","sequence_no","starts_at","ends_at","period_type","teaching_period","active"],
  },
  gradingScales: {
    table: "school_grading_scales", prefix: "grs", order: "is_default DESC,name",
    columns: ["code","name","curriculum","is_default","active"],
  },
  gradeBoundaries: {
    table: "school_grade_boundaries", prefix: "grb", order: "grading_scale_id,sequence_no,min_score DESC",
    columns: ["grading_scale_id","grade","min_score","max_score","points","aggregate_points","remark","color_hex","sequence_no"],
  },
  divisions: {
    table: "school_divisions", prefix: "div", order: "sequence_no,name",
    columns: ["grading_scale_id","code","name","min_aggregate","max_aggregate","min_subjects","rule_json","sequence_no","active"],
    json: { rule: "rule_json" },
  },
  assessmentTypes: {
    table: "school_assessment_types", prefix: "ast", order: "sequence_no,name",
    columns: ["code","name","weight_percent","max_score","sequence_no","active"],
  },
  promotionRules: {
    table: "school_promotion_rules", prefix: "prm", order: "name",
    columns: ["class_level_id","name","minimum_average","maximum_failed_subjects","minimum_attendance_percent","target_class_level_id","allow_manual_override","rule_json","active"],
    json: { rule: "rule_json" },
  },
  calendar: {
    table: "school_calendar_events", prefix: "cal", order: "starts_at DESC,title",
    columns: ["campus_id","academic_year_id","term_id","event_type","title","description","starts_at","ends_at","all_day","teaching_day","recurrence_rule"],
  },
  feeCategories: {
    table: "school_fee_categories", prefix: "fec", order: "name",
    columns: ["code","name","description","income_account_id","receivable_account_id","product_id","taxable","tax_code","refundable","mandatory","active","metadata_json"],
    json: { metadata: "metadata_json" },
  },
  paymentMethods: {
    table: "school_payment_methods", prefix: "pmt", order: "name",
    columns: ["code","name","method_type","account_id","configuration_json","active"],
    json: { configuration: "configuration_json" },
  },
  documentTemplates: {
    table: "school_document_templates", prefix: "tpl", order: "template_type,name,version DESC",
    columns: ["campus_id","template_type","name","version","content_json","is_default","active","created_by","file_id"],
    json: { content: "content_json" },
  },
});

const PROFILE_COLUMNS = Object.freeze([
  "school_code","registration_number","logo_url","logo_file_id","motto","school_type","ownership_type","education_level","curriculum",
  "phone_numbers_json","email_addresses_json","website","physical_address","postal_address","country","district_region","location_text",
  "head_teacher_name","head_teacher_phone","head_teacher_email","language","timezone","date_format","time_format","default_currency",
  "multi_campus_enabled","branding_json","system_preferences_json",
]);
const PROFILE_JSON = Object.freeze({ phoneNumbers: "phone_numbers_json", emailAddresses: "email_addresses_json", branding: "branding_json", systemPreferences: "system_preferences_json" });

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function snake(key) { return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`); }
function decodeJson(value) { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } }
function camelize(row) {
  const out = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    let name = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (key.endsWith("_json")) name = name.replace(/Json$/, "");
    out[name] = key.endsWith("_json") ? decodeJson(value) : value;
  }
  return out;
}
function bounded(value, fallback = 100, max = 500) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.trunc(n))) : fallback; }
function definition(resource) { const def = SETUP_RESOURCES[resource]; if (!def) fail(404, "SCHOOL_SETUP_RESOURCE_NOT_FOUND", `Unknown school setup resource: ${resource}`); return def; }
function columnFor(def, key) { return def.json?.[key] ?? snake(key); }
function normalizeValue(def, key, value) { return def.json?.[key] ? JSON.stringify(value ?? (Array.isArray(value) ? [] : {})) : value; }
function payloadColumns(def, payload) {
  const entries = [];
  for (const [key, value] of Object.entries(payload ?? {})) {
    const column = columnFor(def, key);
    if (!def.columns.includes(column)) continue;
    entries.push([column, normalizeValue(def, key, value === "" ? null : value)]);
  }
  return entries;
}

export class SchoolSetupService {
  constructor({ database }) {
    if (!database || typeof database.query !== "function") throw new TypeError("SchoolSetupService requires database.query()");
    this.database = database;
    this.provider = "postgresql-school-setup";
  }

  async readiness(organizationId) {
    const result = await this.database.query(`SELECT
      to_regclass('public.school_profiles') AS profile,
      to_regclass('public.school_academic_years') AS academic_years,
      to_regclass('public.school_terms') AS terms,
      to_regclass('public.school_class_levels') AS class_levels,
      to_regclass('public.school_subjects') AS subjects,
      to_regclass('public.school_fee_categories') AS fee_categories,
      to_regclass('public.school_roles') AS roles`);
    const row = result.rows[0] ?? {};
    const missing = Object.entries(row).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) return { ok: false, missing };
    if (!organizationId) return { ok: true, missing: [] };
    return { ok: true, missing: [], status: await this.bootstrapStatus(organizationId) };
  }

  async bootstrapStatus(organizationId) {
    const result = await this.database.query(`SELECT
      EXISTS(SELECT 1 FROM school_profiles WHERE organization_id=$1) AS profile,
      EXISTS(SELECT 1 FROM school_academic_years WHERE organization_id=$1) AS academic_year,
      EXISTS(SELECT 1 FROM school_terms WHERE organization_id=$1) AS term,
      EXISTS(SELECT 1 FROM school_class_levels WHERE organization_id=$1) AS class_levels,
      EXISTS(SELECT 1 FROM school_subjects WHERE organization_id=$1) AS subjects,
      EXISTS(SELECT 1 FROM school_fee_categories WHERE organization_id=$1) AS fee_categories,
      EXISTS(SELECT 1 FROM school_roles WHERE organization_id=$1) AS roles`, [organizationId]);
    return camelize(result.rows[0] ?? {});
  }

  async getProfile(organizationId) {
    const result = await this.database.query(`SELECT sp.*,o.name AS school_name
      FROM school_profiles sp JOIN organizations o ON o.id=sp.organization_id
      WHERE sp.organization_id=$1`, [organizationId]);
    return result.rows[0] ? camelize(result.rows[0]) : null;
  }

  async saveProfile(organizationId, payload) {
    const current = await this.getProfile(organizationId);
    const mapped = [];
    for (const [key, raw] of Object.entries(payload ?? {})) {
      if (key === "schoolName") continue;
      const column = PROFILE_JSON[key] ?? snake(key);
      if (!PROFILE_COLUMNS.includes(column)) continue;
      const value = PROFILE_JSON[key] ? JSON.stringify(raw ?? {}) : (raw === "" ? null : raw);
      mapped.push([column, value]);
    }
    if (payload?.schoolName) await this.database.query("UPDATE organizations SET name=$2 WHERE id=$1", [organizationId, String(payload.schoolName).trim()]);
    if (!current) {
      const schoolCode = String(payload?.schoolCode || `SCH-${organizationId.slice(-8)}`).trim();
      const cols = ["organization_id", "school_code", ...mapped.filter(([c]) => c !== "school_code").map(([c]) => c)];
      const vals = [organizationId, schoolCode, ...mapped.filter(([c]) => c !== "school_code").map(([, v]) => v)];
      const placeholders = vals.map((_, i) => `$${i + 1}`);
      await this.database.query(`INSERT INTO school_profiles (${cols.join(",")}) VALUES (${placeholders.join(",")})`, vals);
    } else if (mapped.length) {
      const vals = [organizationId, ...mapped.map(([, v]) => v)];
      const set = mapped.map(([c], i) => `${c}=$${i + 2}`).join(",");
      await this.database.query(`UPDATE school_profiles SET ${set},updated_at=now() WHERE organization_id=$1`, vals);
    }
    return this.getProfile(organizationId);
  }

  async list(resource, organizationId, query = {}) {
    const def = definition(resource);
    const limit = bounded(query.limit, 100);
    const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
    const clauses = ["organization_id=$1"];
    const values = [organizationId];
    const filters = { academicYearId: "academic_year_id", classId: "class_id", classLevelId: "class_level_id", campusId: "campus_id", gradingScaleId: "grading_scale_id", status: "status", active: "active" };
    for (const [key, column] of Object.entries(filters)) {
      if (!def.columns.includes(column) || query[key] == null || query[key] === "") continue;
      values.push(query[key]); clauses.push(`${column}=$${values.length}`);
    }
    values.push(limit, offset);
    const result = await this.database.query(`SELECT * FROM ${def.table} WHERE ${clauses.join(" AND ")} ORDER BY ${def.order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return result.rows.map(camelize);
  }

  async create(resource, organizationId, payload, actorId = null) {
    const def = definition(resource);
    const id = `${def.prefix}_${randomUUID().replaceAll("-", "")}`;
    const entries = payloadColumns(def, payload);
    if (def.columns.includes("created_by") && actorId && !entries.some(([c]) => c === "created_by")) entries.push(["created_by", actorId]);
    const columns = ["id", "organization_id", ...entries.map(([c]) => c)];
    const values = [id, organizationId, ...entries.map(([, v]) => v)];
    const result = await this.database.query(`INSERT INTO ${def.table} (${columns.join(",")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
    return camelize(result.rows[0]);
  }

  async update(resource, organizationId, id, payload) {
    const def = definition(resource);
    const entries = payloadColumns(def, payload);
    if (!entries.length) fail(400, "SCHOOL_SETUP_EMPTY_UPDATE", "No editable school setup fields were supplied");
    const values = [organizationId, id, ...entries.map(([, v]) => v)];
    const set = entries.map(([c], i) => `${c}=$${i + 3}`).join(",");
    const result = await this.database.query(`UPDATE ${def.table} SET ${set},updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, values);
    if (!result.rows[0]) fail(404, "SCHOOL_SETUP_RECORD_NOT_FOUND", "School setup record not found");
    return camelize(result.rows[0]);
  }

  async remove(resource, organizationId, id) {
    const def = definition(resource);
    const result = await this.database.query(`DELETE FROM ${def.table} WHERE organization_id=$1 AND id=$2 RETURNING id`, [organizationId, id]);
    if (!result.rows[0]) fail(404, "SCHOOL_SETUP_RECORD_NOT_FOUND", "School setup record not found");
    return { id, deleted: true };
  }

  async closeTerm(organizationId, id) {
    const result = await this.database.query(`UPDATE school_terms SET status='closed',is_current=false,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, id]);
    if (!result.rows[0]) fail(404, "SCHOOL_TERM_NOT_FOUND", "Term not found");
    return camelize(result.rows[0]);
  }

  async getSettings(organizationId) {
    const result = await this.database.query("SELECT setting_group,setting_key,value_json,updated_at FROM school_settings WHERE organization_id=$1 ORDER BY setting_group,setting_key", [organizationId]);
    const out = {};
    for (const row of result.rows) {
      out[row.setting_group] ??= {};
      out[row.setting_group][row.setting_key] = decodeJson(row.value_json);
    }
    return out;
  }

  async setSetting(organizationId, { group, key, value }, actorId = null) {
    if (!group || !key) fail(400, "SCHOOL_SETTING_INVALID", "group and key are required");
    await this.database.query(`INSERT INTO school_settings(organization_id,setting_group,setting_key,value_json,updated_by)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(organization_id,setting_group,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=now()`,
      [organizationId, String(group), String(key), JSON.stringify(value ?? null), actorId]);
    return { group, key, value };
  }
}

export function createSchoolSetupService(input) { return new SchoolSetupService(input); }
