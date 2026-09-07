// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

export type BookType = "small" | "a4";
export type QueryFilters = {
  bookType?: string | null;
  studentId?: string | null;
  classId?: string | null;
  streamId?: string | null;
  academicYearId?: string | null;
  termId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
};

const BOOK_TYPES = new Set(["small", "a4"]);
export const isoDate = () => new Date().toISOString().slice(0, 10);
export const positiveInt = (value: unknown, label = "quantity") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(422, "VALIDATION_ERROR", `${label} must be a positive whole number`);
  return n;
};
export const signedInt = (value: unknown, label = "quantityDelta") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n === 0) throw new AppError(422, "VALIDATION_ERROR", `${label} must be a non-zero whole number`);
  return n;
};
export const bookType = (value: unknown): BookType => {
  const v = String(value || "").toLowerCase();
  if (!BOOK_TYPES.has(v)) throw new AppError(422, "VALIDATION_ERROR", "bookType must be either small or a4");
  return v as BookType;
};
export const dateValue = (value: unknown, label: string) => {
  const v = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AppError(422, "VALIDATION_ERROR", `${label} must use YYYY-MM-DD`);
  return v;
};

export async function ensureDefaultPermissions(db: D1Database, organizationId: string) {
  const grants: Array<[string, string[]]> = [
    ["school.books:read", ["super_admin","school_admin","head_teacher","deputy_head","director","director_of_studies","head_of_department","teacher","class_teacher","bursar","accountant","registrar","librarian","storekeeper"]],
    ["school.books:write", ["super_admin","school_admin","head_teacher","deputy_head","class_teacher","bursar","accountant","librarian","storekeeper"]],
    ["school.books:manage", ["super_admin","school_admin","head_teacher","deputy_head","director","bursar","librarian","storekeeper"]],
    ["school.books:export", ["super_admin","school_admin","head_teacher","deputy_head","director","director_of_studies","bursar","accountant","registrar","librarian","storekeeper"]],
  ];
  const statements = grants.map(([permission, roles]) => {
    const marks = roles.map(() => "?").join(",");
    return db.prepare(`INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
      SELECT organization_id,id,?,'allow' FROM school_roles WHERE organization_id=? AND code IN (${marks})`)
      .bind(permission, organizationId, ...roles);
  });
  if (statements.length) await db.batch(statements);
}

export async function orgRow(db: D1Database, organizationId: string, table: string, id: string | null | undefined, label: string) {
  if (!id) return null;
  const allowed = new Set(["school_academic_years","school_terms","school_classes","school_streams","school_students"]);
  if (!allowed.has(table)) throw new Error("Unsafe Books reference table");
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).bind(id, organizationId).first<Record<string, unknown>>();
  if (!row) throw new AppError(422, "INVALID_REFERENCE", `${label} does not belong to this school`);
  return row;
}

export async function currentPeriod(db: D1Database, organizationId: string) {
  const year = await db.prepare("SELECT id,name FROM school_academic_years WHERE organization_id=? AND is_current=1 ORDER BY starts_on DESC LIMIT 1")
    .bind(organizationId).first<{id:string;name:string}>();
  const term = await db.prepare("SELECT id,name,academic_year_id AS academicYearId FROM school_terms WHERE organization_id=? AND is_current=1 ORDER BY starts_on DESC LIMIT 1")
    .bind(organizationId).first<{id:string;name:string;academicYearId:string}>();
  return { year: year || null, term: term || null };
}

export async function resolvePeriod(db: D1Database, organizationId: string, academicYearId?: string | null, termId?: string | null) {
  const current = await currentPeriod(db, organizationId);
  let yearId = academicYearId || current.year?.id || null;
  let chosenTermId = termId || (current.term && (!yearId || current.term.academicYearId === yearId) ? current.term.id : null);
  if (yearId) await orgRow(db, organizationId, "school_academic_years", yearId, "Academic year");
  if (chosenTermId) {
    const term = await orgRow(db, organizationId, "school_terms", chosenTermId, "Term") as Record<string, unknown>;
    const termYear = String(term.academic_year_id || "");
    if (!yearId) yearId = termYear || null;
    if (yearId && termYear !== yearId) throw new AppError(422, "PERIOD_MISMATCH", "The selected term is not in the selected academic year");
  }
  return { academicYearId: yearId, termId: chosenTermId };
}

export async function studentContext(db: D1Database, organizationId: string, studentId: string) {
  const row = await db.prepare(`SELECT s.id,s.admission_number AS admissionNumber,s.student_number AS studentNumber,
      trim(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) AS name,
      s.status,s.current_academic_year_id AS academicYearId,s.current_class_id AS classId,s.current_stream_id AS streamId,
      c.name AS className,st.name AS streamName
    FROM school_students s
    LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
    WHERE s.id=? AND s.organization_id=? AND s.deleted_at IS NULL`)
    .bind(studentId, organizationId).first<Record<string, any>>();
  if (!row) throw new AppError(404, "STUDENT_NOT_FOUND", "Learner not found in School Management");
  if (row.status !== "active") throw new AppError(409, "STUDENT_NOT_ACTIVE", `${row.name} is not an active learner`);
  return row;
}

export async function referenceData(db: D1Database, organizationId: string) {
  const [years, terms, classes, streams] = await Promise.all([
    db.prepare("SELECT id,code,name,status,is_current AS isCurrent,starts_on AS startsOn,ends_on AS endsOn FROM school_academic_years WHERE organization_id=? ORDER BY starts_on DESC").bind(organizationId).all(),
    db.prepare("SELECT id,academic_year_id AS academicYearId,code,name,sequence_no AS sequenceNo,status,is_current AS isCurrent,starts_on AS startsOn,ends_on AS endsOn FROM school_terms WHERE organization_id=? ORDER BY starts_on DESC").bind(organizationId).all(),
    db.prepare("SELECT c.id,c.academic_year_id AS academicYearId,c.class_level_id AS classLevelId,c.code,c.name,c.active,l.name AS levelName FROM school_classes c LEFT JOIN school_class_levels l ON l.id=c.class_level_id WHERE c.organization_id=? AND c.active=1 ORDER BY l.sequence_no,c.name").bind(organizationId).all(),
    db.prepare("SELECT s.id,s.class_id AS classId,s.code,s.name,s.active FROM school_streams s JOIN school_classes c ON c.id=s.class_id WHERE s.organization_id=? AND s.active=1 AND c.active=1 ORDER BY c.name,s.name").bind(organizationId).all(),
  ]);
  const current = await currentPeriod(db, organizationId);
  return { bookTypes: ["small","a4"], years: years.results, terms: terms.results, classes: classes.results, streams: streams.results, current };
}

export async function listStudents(db: D1Database, organizationId: string, filters: {classId?:string|null;streamId?:string|null;q?:string|null;limit?:number}) {
  const where = ["s.organization_id=?", "s.deleted_at IS NULL", "s.status='active'"];
  const args: unknown[] = [organizationId];
  if (filters.classId) { where.push("s.current_class_id=?"); args.push(filters.classId); }
  if (filters.streamId) { where.push("s.current_stream_id=?"); args.push(filters.streamId); }
  if (filters.q) {
    const q = `%${filters.q.toLowerCase()}%`;
    where.push("(lower(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) LIKE ? OR lower(s.admission_number) LIKE ? OR lower(s.student_number) LIKE ?)");
    args.push(q,q,q);
  }
  const limit = Math.max(1, Math.min(500, Number(filters.limit) || 200));
  const rows = await db.prepare(`SELECT s.id,s.admission_number AS admissionNumber,s.student_number AS studentNumber,
      trim(s.first_name || ' ' || COALESCE(s.middle_name || ' ','') || s.last_name) AS name,
      s.current_academic_year_id AS academicYearId,s.current_class_id AS classId,s.current_stream_id AS streamId,
      c.name AS className,st.name AS streamName
    FROM school_students s
    LEFT JOIN school_classes c ON c.id=s.current_class_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id
    WHERE ${where.join(" AND ")}
    ORDER BY c.name,st.name,s.last_name,s.first_name LIMIT ?`).bind(...args, limit).all();
  return rows.results;
}

export async function stockSummary(db: D1Database, organizationId: string) {
  const rows = await db.prepare(`WITH types(book_type) AS (SELECT 'small' UNION ALL SELECT 'a4')
    SELECT t.book_type AS bookType,
      COALESCE((SELECT SUM(m.quantity_delta) FROM bks_stock_movements m WHERE m.organization_id=? AND m.book_type=t.book_type AND m.reversed_at IS NULL),0) AS stockIn,
      COALESCE((SELECT SUM(d.quantity) FROM bks_distributions d WHERE d.organization_id=? AND d.book_type=t.book_type AND d.reversed_at IS NULL),0) AS issued,
      COALESCE((SELECT SUM(m.quantity_delta) FROM bks_stock_movements m WHERE m.organization_id=? AND m.book_type=t.book_type AND m.reversed_at IS NULL),0)
      - COALESCE((SELECT SUM(d.quantity) FROM bks_distributions d WHERE d.organization_id=? AND d.book_type=t.book_type AND d.reversed_at IS NULL),0) AS available
    FROM types t ORDER BY t.book_type`)
    .bind(organizationId,organizationId,organizationId,organizationId).all<Record<string, any>>();
  return rows.results.map(r => ({...r, stockIn:Number(r.stockIn||0), issued:Number(r.issued||0), available:Number(r.available||0)}));
}

export async function assertStock(db: D1Database, organizationId: string, type: BookType, required: number) {
  const stock = await stockSummary(db, organizationId);
  const row = stock.find(x => x.bookType === type);
  const available = Number(row?.available || 0);
  if (available < required) throw new AppError(409, "INSUFFICIENT_BOOK_STOCK", `Only ${available} ${type === "a4" ? "A4" : "small"} book(s) are available; ${required} required`, {bookType:type, available, required});
  return available;
}
