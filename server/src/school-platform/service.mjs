const RESOURCE_DEFINITIONS = Object.freeze({
  "academic-years": { table: "school_academic_years", order: "starts_on DESC, name", filters: { status: "status" } },
  terms: { table: "school_terms", order: "academic_year_id, sequence_no, starts_on", filters: { academicYearId: "academic_year_id", status: "status" } },
  classes: { table: "school_classes", order: "academic_year_id, name", filters: { academicYearId: "academic_year_id" } },
  streams: { table: "school_streams", order: "class_id, name", filters: { classId: "class_id" } },
  subjects: { table: "school_subjects", order: "name", filters: {} },
  students: { table: "school_students", order: "last_name, first_name, admission_number", filters: { academicYearId: "current_academic_year_id", classId: "current_class_id", streamId: "current_stream_id", status: "status" } },
  guardians: { table: "school_guardians", order: "last_name, first_name", filters: {} },
  staff: { table: "school_staff_profiles", order: "last_name, first_name, staff_number", filters: { status: "employment_status" } },
  schemes: { table: "acad_schemes", order: "academic_year_id, term_id, updated_at DESC", filters: { academicYearId: "academic_year_id", termId: "term_id", classId: "class_id", streamId: "stream_id", subjectId: "subject_id", status: "status" } },
  "lesson-plans": { table: "acad_lesson_plans", order: "lesson_date DESC, updated_at DESC", filters: { academicYearId: "academic_year_id", termId: "term_id", classId: "class_id", streamId: "stream_id", subjectId: "subject_id", status: "status" } },
  observations: { table: "acad_observations", order: "observed_at DESC NULLS LAST, created_at DESC", filters: { classId: "class_id", streamId: "stream_id", subjectId: "subject_id", status: "status" } },
  inspections: { table: "acad_inspections", order: "inspected_on DESC, created_at DESC", filters: { classId: "class_id", streamId: "stream_id", subjectId: "subject_id", status: "status" } },
  "attendance-sessions": { table: "att_sessions", order: "attendance_date DESC, starts_at DESC", filters: { academicYearId: "academic_year_id", termId: "term_id", classId: "class_id", streamId: "stream_id", subjectId: "subject_id", status: "status" } },
  "attendance-records": { table: "att_records", order: "attendance_date DESC, updated_at DESC", filters: { status: "status" } },
  "attendance-events": { table: "att_events", order: "captured_at DESC", filters: {} },
  "book-batches": { table: "bks_distribution_batches", order: "distributed_on DESC, created_at DESC", filters: { academicYearId: "academic_year_id", termId: "term_id", classId: "class_id", streamId: "stream_id" } },
  "book-distributions": { table: "bks_distributions", order: "distributed_on DESC, created_at DESC", filters: { academicYearId: "academic_year_id", termId: "term_id", classId: "class_id", streamId: "stream_id", studentId: "student_id" } },
});

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function decodeJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function camelizeRow(row) {
  const output = {};
  for (const [key, raw] of Object.entries(row ?? {})) {
    const camel = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    if (key.endsWith("_json")) output[camel.replace(/Json$/, "")] = decodeJson(raw);
    else output[camel] = raw;
  }
  return output;
}

function filtersFor(definition, query) {
  const clauses = ["organization_id=$1"];
  const values = [query.organizationId];
  for (const [input, column] of Object.entries(definition.filters ?? {})) {
    const value = query[input];
    if (value == null || value === "") continue;
    values.push(String(value));
    clauses.push(`${column}=$${values.length}`);
  }
  return { clauses, values };
}

export class SchoolPlatformService {
  constructor({ database }) {
    if (!database || typeof database.query !== "function") throw new TypeError("SchoolPlatformService requires database.query()");
    this.database = database;
    this.provider = "postgresql-school-platform";
  }

  describe() {
    return { provider: this.provider, mode: "read-only-until-cutover", resources: Object.keys(RESOURCE_DEFINITIONS) };
  }

  async readiness() {
    try {
      const result = await this.database.query("SELECT to_regclass('public.school_students') AS students, to_regclass('public.acad_lesson_plans') AS academics, to_regclass('public.att_records') AS attendance, to_regclass('public.bks_distributions') AS books");
      const row = result.rows[0] ?? {};
      const missing = Object.entries(row).filter(([, value]) => !value).map(([name]) => name);
      return { ok: missing.length === 0, provider: this.provider, missing };
    } catch (error) {
      return { ok: false, provider: this.provider, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async overview(organizationId) {
    const result = await this.database.query(
      `SELECT
        (SELECT count(*)::bigint FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL) AS students,
        (SELECT count(*)::bigint FROM school_guardians WHERE organization_id=$1) AS guardians,
        (SELECT count(*)::bigint FROM school_staff_profiles WHERE organization_id=$1 AND deleted_at IS NULL) AS staff,
        (SELECT count(*)::bigint FROM acad_lesson_plans WHERE organization_id=$1) AS lesson_plans,
        (SELECT count(*)::bigint FROM att_records WHERE organization_id=$1) AS attendance_records,
        (SELECT count(*)::bigint FROM bks_distributions WHERE organization_id=$1) AS book_distributions`,
      [organizationId],
    );
    const row = result.rows[0] ?? {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), Number(value ?? 0)]));
  }

  async references(organizationId, { academicYearId = null, classId = null } = {}) {
    const [years, terms, classes, streams, subjects] = await Promise.all([
      this.database.query("SELECT id,code,name,starts_on,ends_on,status,is_current FROM school_academic_years WHERE organization_id=$1 ORDER BY starts_on DESC", [organizationId]),
      academicYearId
        ? this.database.query("SELECT id,academic_year_id,code,name,sequence_no,starts_on,ends_on,status,is_current FROM school_terms WHERE organization_id=$1 AND academic_year_id=$2 ORDER BY sequence_no", [organizationId, academicYearId])
        : this.database.query("SELECT id,academic_year_id,code,name,sequence_no,starts_on,ends_on,status,is_current FROM school_terms WHERE organization_id=$1 ORDER BY academic_year_id,sequence_no", [organizationId]),
      academicYearId
        ? this.database.query("SELECT id,academic_year_id,class_level_id,code,name,active FROM school_classes WHERE organization_id=$1 AND academic_year_id=$2 ORDER BY name", [organizationId, academicYearId])
        : this.database.query("SELECT id,academic_year_id,class_level_id,code,name,active FROM school_classes WHERE organization_id=$1 ORDER BY academic_year_id,name", [organizationId]),
      classId
        ? this.database.query("SELECT id,class_id,code,name,active FROM school_streams WHERE organization_id=$1 AND class_id=$2 ORDER BY name", [organizationId, classId])
        : this.database.query("SELECT id,class_id,code,name,active FROM school_streams WHERE organization_id=$1 ORDER BY class_id,name", [organizationId]),
      classId
        ? this.database.query(`SELECT DISTINCT s.id,s.code,s.name,s.short_name,s.subject_type,s.active
            FROM school_subjects s
            JOIN school_classes c ON c.id=$2 AND c.organization_id=s.organization_id
            JOIN school_class_subjects cs ON cs.organization_id=s.organization_id AND cs.subject_id=s.id AND cs.class_level_id=c.class_level_id
            WHERE s.organization_id=$1 AND s.active=true AND cs.active=true
              AND (cs.academic_year_id IS NULL OR cs.academic_year_id=c.academic_year_id)
            ORDER BY s.name`, [organizationId, classId])
        : this.database.query("SELECT id,code,name,short_name,subject_type,active FROM school_subjects WHERE organization_id=$1 ORDER BY name", [organizationId]),
    ]);
    return { academicYears: years.rows.map(camelizeRow), terms: terms.rows.map(camelizeRow), classes: classes.rows.map(camelizeRow), streams: streams.rows.map(camelizeRow), subjects: subjects.rows.map(camelizeRow) };
  }

  async list(resource, query) {
    const definition = RESOURCE_DEFINITIONS[resource];
    if (!definition) {
      const error = new Error(`Unknown school resource: ${resource}`);
      error.status = 404;
      error.code = "SCHOOL_RESOURCE_NOT_FOUND";
      throw error;
    }
    if (!query?.organizationId) throw new TypeError("organizationId is required");
    const limit = boundedInt(query.limit, 100, 1, 500);
    const offset = boundedInt(query.offset, 0, 0, 1_000_000_000);
    const { clauses, values } = filtersFor(definition, query);
    values.push(limit, offset);
    const result = await this.database.query(
      `SELECT * FROM ${definition.table} WHERE ${clauses.join(" AND ")} ORDER BY ${definition.order} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return { resource, limit, offset, count: result.rows.length, items: result.rows.map(camelizeRow) };
  }
}

export function createSchoolPlatformService(input) { return new SchoolPlatformService(input); }
