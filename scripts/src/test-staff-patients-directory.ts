import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mirrors staff-patients-api ageFromDob — birthday must have occurred this year. */
function ageFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

function patientDisplayName(p: { lastName: string; firstName: string; middleName?: string | null }) {
  const middle = p.middleName ? ` ${p.middleName}` : "";
  return `${p.lastName}, ${p.firstName}${middle}`.replace(/\s+/g, " ").trim();
}

function patientInitials(p: { lastName: string; firstName: string }) {
  const a = (p.firstName?.trim()?.[0] ?? "").toUpperCase();
  const b = (p.lastName?.trim()?.[0] ?? "").toUpperCase();
  return `${a}${b}` || "PT";
}

test("patient display helpers format name and initials without inventing sex", () => {
  assert.equal(
    patientDisplayName({ lastName: "RAMA", firstName: "CARLA JOY", middleName: "M." }),
    "RAMA, CARLA JOY M.",
  );
  assert.equal(patientInitials({ lastName: "RAMA", firstName: "CARLA JOY" }), "CR");
  assert.equal(patientInitials({ lastName: "", firstName: "" }), "PT");
});

test("ageFromDob uses current date and ignores invalid values", () => {
  const today = new Date();
  const twentieth = new Date(today.getFullYear() - 20, today.getMonth(), today.getDate());
  assert.equal(ageFromDob(isoLocal(twentieth)), 20);

  const lastMonth = new Date(today.getFullYear() - 20, today.getMonth() - 1, Math.min(28, today.getDate()));
  assert.equal(ageFromDob(isoLocal(lastMonth)), 20);

  const nextMonth = new Date(today.getFullYear() - 20, today.getMonth() + 1, Math.min(28, today.getDate()));
  assert.equal(ageFromDob(isoLocal(nextMonth)), 19);

  assert.equal(ageFromDob(null), null);
  assert.equal(ageFromDob("not-a-date"), null);
});

test("directory-summary and list filters share the staff patient scope helper", () => {
  const patientsRoute = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/routes/patients.ts"),
    "utf8",
  );
  const patientsRepo = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/src/repos/patients.ts"),
    "utf8",
  );

  assert.match(patientsRoute, /router\.get\("\/patients\/directory-summary"/);
  assert.match(patientsRoute, /patientsRepo\.getDirectoryStats\(scope\.ids\)/);
  assert.match(patientsRoute, /resolveStaffPatientScope/);
  assert.match(patientsRoute, /Unable to load patient directory summary/);
  assert.match(patientsRoute, /hasResults/);
  assert.match(patientsRoute, /hasPhysician/);
  assert.match(patientsRepo, /export async function getDirectoryStats/);
  assert.match(patientsRepo, /registeredThisMonth/);
  assert.match(patientsRepo, /withResults/);
  assert.match(patientsRepo, /email LIKE @search/);
  // SQL Server error 130: aggregates cannot contain EXISTS subqueries.
  assert.equal(/SUM\s*\(\s*CASE\s+WHEN\s+EXISTS/i.test(patientsRepo), false);
  assert.match(patientsRepo, /LEFT JOIN\s*\(\s*SELECT DISTINCT patient_id/i);
  assert.match(patientsRepo, /status <> N'archived'/);
});

test("directory-summary does not fabricate zero counts on query failure", () => {
  const patientsRoute = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/routes/patients.ts"),
    "utf8",
  );
  const start = patientsRoute.indexOf('router.get("/patients/directory-summary"');
  const end = patientsRoute.indexOf('router.get("/patients/hospital-lookup"');
  const summary = patientsRoute.slice(start, end);
  assert.match(summary, /try\s*\{/);
  assert.match(summary, /catch\s*\(/);
  assert.match(summary, /res\.status\(500\)\.json\(\{\s*error:\s*"Unable to load patient directory summary"/);
  assert.equal(/totalPatients:\s*0/.test(summary), false);
  assert.equal(/registeredThisMonth:\s*0/.test(summary), false);
});
