import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationPhase } from "../src/migration/phases.mjs";
import { SCHOOL_CONFIGURATION_TABLES, SCHOOL_PEOPLE_TABLES, SCHOOL_STAFF_TABLES } from "../src/migration/school-data-manifest.mjs";

function names(items) { return items.map((item) => item.name); }

test("school data phases expose dependency ordering", () => {
  assert.deepEqual(getMigrationPhase("school-configuration").prerequisites, ["auth-core","school-reference"]);
  assert.deepEqual(getMigrationPhase("school-people").prerequisites, ["auth-core","school-reference","school-configuration"]);
  assert.deepEqual(getMigrationPhase("school-staff").prerequisites, ["auth-core","school-reference","school-configuration"]);
  assert.ok(names(SCHOOL_CONFIGURATION_TABLES).indexOf("school_files") < names(SCHOOL_CONFIGURATION_TABLES).indexOf("school_document_templates"));
  assert.ok(names(SCHOOL_PEOPLE_TABLES).indexOf("school_students") < names(SCHOOL_PEOPLE_TABLES).indexOf("school_student_guardians"));
  assert.ok(names(SCHOOL_PEOPLE_TABLES).indexOf("school_student_promotions") < names(SCHOOL_PEOPLE_TABLES).indexOf("school_promotion_run_items"));
  assert.ok(names(SCHOOL_STAFF_TABLES).indexOf("school_staff_profiles") < names(SCHOOL_STAFF_TABLES).indexOf("school_staff_teaching_assignments"));
});

test("school data transforms convert SQLite integer flags and preserve stable IDs", () => {
  const guardian = SCHOOL_PEOPLE_TABLES.find((item) => item.name === "school_guardians");
  const transformedGuardian = guardian.transform({ id: "guardian-1", organization_id: "org-1", active: 0 });
  assert.equal(transformedGuardian.id, "guardian-1");
  assert.equal(transformedGuardian.active, false);

  const links = SCHOOL_PEOPLE_TABLES.find((item) => item.name === "school_student_guardians");
  const transformedLink = links.transform({ organization_id: "org-1", student_id: "student-1", guardian_id: "guardian-1", is_primary: 1, receives_academic_updates: 0 });
  assert.equal(transformedLink.student_id, "student-1");
  assert.equal(transformedLink.is_primary, true);
  assert.equal(transformedLink.receives_academic_updates, false);

  const position = SCHOOL_STAFF_TABLES.find((item) => item.name === "school_staff_positions");
  const transformedPosition = position.transform({ id: "pos-1", organization_id: "org-1", is_teaching: 1, is_management: 0, active: 1 });
  assert.equal(transformedPosition.id, "pos-1");
  assert.equal(transformedPosition.is_teaching, true);
  assert.equal(transformedPosition.is_management, false);
});

test("late D1 columns are present in final manifests", () => {
  const profile = getMigrationPhase("school-reference").tables.find((item) => item.name === "school_profiles");
  assert.ok(profile.columns.includes("logo_file_id"));
  const student = SCHOOL_PEOPLE_TABLES.find((item) => item.name === "school_students");
  const guardian = SCHOOL_PEOPLE_TABLES.find((item) => item.name === "school_guardians");
  const studentDocument = SCHOOL_PEOPLE_TABLES.find((item) => item.name === "school_student_documents");
  assert.ok(student.columns.includes("profile_photo_file_id"));
  assert.ok(guardian.columns.includes("profile_photo_file_id"));
  assert.ok(studentDocument.columns.includes("file_id"));
});

test("payroll posting tables remain outside school staff ownership", () => {
  assert.equal(names(SCHOOL_STAFF_TABLES).includes("school_staff_salary_payments"), false);
  assert.equal(names(SCHOOL_STAFF_TABLES).includes("payroll_lines"), false);
});
