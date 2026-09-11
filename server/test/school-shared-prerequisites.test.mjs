import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationPhase } from "../src/migration/phases.mjs";
import { SCHOOL_PEOPLE_RELATIONSHIP_CHECKS, SCHOOL_STAFF_RELATIONSHIP_CHECKS } from "../src/migration/school-data-validators.mjs";
import { ATTENDANCE_RELATIONSHIP_CHECKS } from "../src/migration/attendance-validators.mjs";
import { BOOKS_RELATIONSHIP_CHECKS } from "../src/migration/books-validators.mjs";

const checkNames = (checks) => checks.map(([name]) => name);

test("school identity phases require shared contacts before copying cross-module IDs", () => {
  assert.ok(getMigrationPhase("school-people").prerequisites.includes("contacts"));
  assert.ok(getMigrationPhase("school-staff").prerequisites.includes("contacts"));
  assert.ok(checkNames(SCHOOL_PEOPLE_RELATIONSHIP_CHECKS).includes("school_people.student_contact"));
  assert.ok(checkNames(SCHOOL_PEOPLE_RELATIONSHIP_CHECKS).includes("school_people.guardian_contact_tenant"));
  assert.ok(checkNames(SCHOOL_STAFF_RELATIONSHIP_CHECKS).includes("school_staff.profile_contact"));
  assert.ok(checkNames(SCHOOL_STAFF_RELATIONSHIP_CHECKS).includes("school_staff.profile_contact_tenant"));
});

test("offline school phases require shared mobile sync before validating device references", () => {
  assert.ok(getMigrationPhase("attendance").prerequisites.includes("mobile-sync-core"));
  assert.ok(getMigrationPhase("books").prerequisites.includes("mobile-sync-core"));
  assert.ok(checkNames(ATTENDANCE_RELATIONSHIP_CHECKS).includes("attendance.event_mobile_device"));
  assert.ok(checkNames(ATTENDANCE_RELATIONSHIP_CHECKS).includes("attendance.event_mobile_device_tenant"));
  assert.ok(checkNames(BOOKS_RELATIONSHIP_CHECKS).includes("books.mobile_device"));
  assert.ok(checkNames(BOOKS_RELATIONSHIP_CHECKS).includes("books.mobile_device_tenant"));
});
