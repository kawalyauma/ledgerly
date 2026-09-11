import test from "node:test";
import assert from "node:assert/strict";
import { SchoolPlatformService } from "../src/school-platform/service.mjs";
import extension from "../src/extensions/school-platform.extension.mjs";
import route from "../src/http/routes/school-platform.route.mjs";

function fakeDatabase(rowsBySql = new Map()) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      for (const [needle, rows] of rowsBySql) if (sql.includes(needle)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

test("school runtime extension is opt-in and keeps Cloudflare write authority by default", async () => {
  assert.deepEqual(extension.configure({}), { enabled: false });
  assert.deepEqual(extension.configure({ LEDGERLY_SCHOOL_SELFHOST_ENABLED: "true" }), { enabled: true });
  assert.equal(route.enabled({ extensions: { "school-platform": { enabled: true } } }), true);
});

test("school platform lists only tenant-scoped rows with bounded pagination", async () => {
  const database = fakeDatabase(new Map([["FROM school_students", [{ id: "std-1", organization_id: "org-1", first_name: "A", custom_fields_json: "{}" }]]]));
  const service = new SchoolPlatformService({ database });
  const result = await service.list("students", { organizationId: "org-1", limit: 9999, offset: -4, status: "active" });
  assert.equal(result.items[0].id, "std-1");
  assert.deepEqual(result.items[0].customFields, {});
  assert.match(database.calls[0].sql, /organization_id=\$1/);
  assert.match(database.calls[0].sql, /status=\$2/);
  assert.deepEqual(database.calls[0].values, ["org-1", "active", 500, 0]);
});

test("resource filters are allow-listed per physical table", async () => {
  const database = fakeDatabase();
  const service = new SchoolPlatformService({ database });
  await service.list("guardians", { organizationId: "org-1", status: "active", subjectId: "sub-1" });
  assert.doesNotMatch(database.calls[0].sql, /status=|subject_id=/);
  await service.list("staff", { organizationId: "org-1", status: "active" });
  assert.match(database.calls[1].sql, /employment_status=\$2/);
  await service.list("book-distributions", { organizationId: "org-1", studentId: "std-1" });
  assert.match(database.calls[2].sql, /student_id=\$2/);
  assert.match(database.calls[2].sql, /ORDER BY distributed_on DESC/);
  await service.list("inspections", { organizationId: "org-1" });
  assert.match(database.calls[3].sql, /ORDER BY inspected_on DESC/);
});

test("reference API applies year/class context instead of returning unrelated terms and subjects", async () => {
  const database = fakeDatabase();
  const service = new SchoolPlatformService({ database });
  await service.references("org-1", { academicYearId: "ay-2026", classId: "class-p3" });
  const terms = database.calls.find((call) => call.sql.includes("FROM school_terms"));
  const classes = database.calls.find((call) => call.sql.includes("FROM school_classes"));
  const subjects = database.calls.find((call) => call.sql.includes("FROM school_subjects"));
  assert.deepEqual(terms.values, ["org-1", "ay-2026"]);
  assert.deepEqual(classes.values, ["org-1", "ay-2026"]);
  assert.deepEqual(subjects.values, ["org-1", "class-p3"]);
  assert.match(subjects.sql, /school_class_subjects/);
  assert.match(subjects.sql, /cs\.academic_year_id IS NULL OR cs\.academic_year_id=c\.academic_year_id/);
});

test("HTTP route authenticates, requires school read scope, and rejects writes before cutover", async () => {
  const required = [];
  const runtime = {
    auth: {
      async authenticateRequest() { return { organizationId: "org-1", userId: "usr-1", role: "teacher", scopes: ["school:read"] }; },
      requireScope(principal, scope) { required.push([principal.organizationId, scope]); },
    },
    extensions: { "school-platform": new SchoolPlatformService({ database: fakeDatabase() }) },
  };
  const response = await route.handle({ request: new Request("http://localhost/selfhost/school/students", { method: "POST" }), url: new URL("http://localhost/selfhost/school/students"), runtime });
  assert.equal(response.status, 405);
  assert.deepEqual(required, [["org-1", "school:read"]]);
  assert.equal(response.body.error.code, "SCHOOL_SELFHOST_READ_ONLY");
});
