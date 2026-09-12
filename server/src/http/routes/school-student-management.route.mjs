const PREFIX = "/api/v1/school/student-management";

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function bounded(value, fallback = 100, max = 500) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.trunc(n))) : fallback; }
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
async function rows(database, sql, values = []) { const result = await database.query(sql, values); return result.rows.map(camelize); }

async function studentList(database, organizationId, url) {
  const clauses = ["s.organization_id=$1", "s.deleted_at IS NULL"];
  const values = [organizationId];
  const filters = [
    ["status", "s.status"], ["classId", "s.current_class_id"], ["streamId", "s.current_stream_id"],
    ["campusId", "s.campus_id"], ["academicYearId", "s.current_academic_year_id"],
  ];
  for (const [param, column] of filters) {
    const value = url.searchParams.get(param);
    if (!value) continue;
    values.push(value); clauses.push(`${column}=$${values.length}`);
  }
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    clauses.push(`(lower(coalesce(s.first_name,'')||' '||coalesce(s.middle_name,'')||' '||coalesce(s.last_name,'')) LIKE $${values.length} OR lower(s.admission_number) LIKE $${values.length} OR lower(s.student_number) LIKE $${values.length})`);
  }
  const limit = bounded(url.searchParams.get("limit"), 100), offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  values.push(limit, offset);
  return rows(database, `SELECT s.*,ay.name AS academic_year_name,c.name AS class_name,st.name AS stream_name,b.name AS campus_name
    FROM school_students s
    LEFT JOIN school_academic_years ay ON ay.id=s.current_academic_year_id AND ay.organization_id=s.organization_id
    LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
    LEFT JOIN school_branches b ON b.id=s.campus_id AND b.organization_id=s.organization_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY s.last_name,s.first_name,s.admission_number LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
}

async function studentDetail(database, organizationId, studentId) {
  const base = await rows(database, `SELECT s.*,ay.name AS academic_year_name,c.name AS class_name,st.name AS stream_name,b.name AS campus_name
    FROM school_students s
    LEFT JOIN school_academic_years ay ON ay.id=s.current_academic_year_id AND ay.organization_id=s.organization_id
    LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
    LEFT JOIN school_branches b ON b.id=s.campus_id AND b.organization_id=s.organization_id
    WHERE s.organization_id=$1 AND s.id=$2 AND s.deleted_at IS NULL`, [organizationId, studentId]);
  if (!base[0]) fail(404, "SCHOOL_STUDENT_NOT_FOUND", "Student not found");
  const [guardians, enrollments, medicalRows, notes, documents, siblings, timeline] = await Promise.all([
    rows(database, `SELECT g.*,sg.relationship,sg.is_primary,sg.is_emergency_contact,sg.is_authorized_pickup,sg.is_financially_responsible,sg.receives_academic_updates,sg.receives_financial_updates
      FROM school_student_guardians sg JOIN school_guardians g ON g.id=sg.guardian_id AND g.organization_id=sg.organization_id
      WHERE sg.organization_id=$1 AND sg.student_id=$2 ORDER BY sg.is_primary DESC,g.last_name,g.first_name`, [organizationId, studentId]),
    rows(database, `SELECT e.*,ay.name AS academic_year_name,c.name AS class_name,st.name AS stream_name
      FROM school_enrollments e LEFT JOIN school_academic_years ay ON ay.id=e.academic_year_id LEFT JOIN school_classes c ON c.id=e.class_id LEFT JOIN school_streams st ON st.id=e.stream_id
      WHERE e.organization_id=$1 AND e.student_id=$2 ORDER BY e.enrolled_on DESC,e.created_at DESC`, [organizationId, studentId]),
    rows(database, "SELECT * FROM school_student_medical WHERE organization_id=$1 AND student_id=$2", [organizationId, studentId]),
    rows(database, "SELECT * FROM school_student_notes WHERE organization_id=$1 AND student_id=$2 ORDER BY created_at DESC", [organizationId, studentId]),
    rows(database, "SELECT * FROM school_student_documents WHERE organization_id=$1 AND student_id=$2 ORDER BY created_at DESC", [organizationId, studentId]),
    rows(database, `SELECT sib.id,sib.admission_number,sib.student_number,sib.first_name,sib.middle_name,sib.last_name,ss.sibling_student_id
      FROM school_student_siblings ss JOIN school_students sib ON sib.id=ss.sibling_student_id AND sib.organization_id=ss.organization_id
      WHERE ss.organization_id=$1 AND ss.student_id=$2 ORDER BY sib.last_name,sib.first_name`, [organizationId, studentId]),
    rows(database, "SELECT * FROM school_student_timeline WHERE organization_id=$1 AND student_id=$2 ORDER BY event_at DESC,created_at DESC", [organizationId, studentId]),
  ]);
  return { ...base[0], guardians, enrollments, medical: medicalRows[0] ?? null, notes, documents, siblings, timeline };
}

async function admissions(database, organizationId, url) {
  const clauses = ["organization_id=$1"], values = [organizationId];
  const status = url.searchParams.get("status");
  if (status) { values.push(status); clauses.push(`status=$${values.length}`); }
  const q = url.searchParams.get("q")?.trim();
  if (q) { values.push(`%${q.toLowerCase()}%`); clauses.push(`(lower(application_number) LIKE $${values.length} OR lower(applicant_json) LIKE $${values.length})`); }
  const limit = bounded(url.searchParams.get("limit"), 100); values.push(limit);
  return rows(database, `SELECT * FROM school_admission_applications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT $${values.length}`, values);
}

export default {
  name: "school-student-management",
  prefix: PREFIX,
  business: true,
  priority: 35,
  enabled(config) { return config.extensions?.["school-platform"]?.enabled === true; },
  async handle({ request, url, runtime, config }) {
    const principal = await runtime.auth.authenticateRequest({ headers: request.headers });
    const isWrite = request.method !== "GET" && request.method !== "HEAD";
    runtime.auth.requireScope(principal, isWrite ? "school:write" : "school:read");
    if (isWrite) {
      const mode = config.extensions?.["school-platform"]?.peopleWriteCutover ?? "cloudflare";
      fail(503, "SCHOOL_PEOPLE_WRITE_NOT_CUT_OVER", mode === "node"
        ? "School people writes are not enabled until the PostgreSQL transaction parity suite passes"
        : "School people writes remain on Cloudflare until PostgreSQL cutover validation passes");
    }
    const database = runtime.services.database;
    const path = url.pathname.slice(PREFIX.length) || "/";

    if (path === "/reports/enrollment") {
      return { status: 200, body: { data: await rows(database, `SELECT ay.name AS academic_year,c.name AS class_name,st.name AS stream_name,s.status,count(*)::bigint AS students
        FROM school_students s LEFT JOIN school_academic_years ay ON ay.id=s.current_academic_year_id LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id
        WHERE s.organization_id=$1 AND s.deleted_at IS NULL GROUP BY ay.name,c.name,st.name,s.status ORDER BY ay.name,c.name,st.name,s.status`, [principal.organizationId]) } };
    }
    if (path === "/reports/demographics") {
      return { status: 200, body: { data: await rows(database, `SELECT gender,nationality,residency_status,status,count(*)::bigint AS students
        FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL GROUP BY gender,nationality,residency_status,status ORDER BY count(*) DESC`, [principal.organizationId]) } };
    }
    if (path === "/admissions") return { status: 200, body: { data: await admissions(database, principal.organizationId, url) } };
    if (path === "/guardians") return { status: 200, body: { data: await rows(database, "SELECT * FROM school_guardians WHERE organization_id=$1 AND active=true ORDER BY last_name,first_name LIMIT 500", [principal.organizationId]) } };
    if (path === "/students") return { status: 200, body: { data: await studentList(database, principal.organizationId, url) } };
    const match = path.match(/^\/students\/([^/]+)$/);
    if (match) return { status: 200, body: { data: await studentDetail(database, principal.organizationId, decodeURIComponent(match[1])) } };

    fail(404, "SCHOOL_STUDENT_ROUTE_NOT_FOUND", "School student route not found");
  },
};
