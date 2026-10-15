import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ListPatientsQueryParams } from "../../lib/api-zod/src/generated/api.ts";
import { staffDirectoryConstraint, createMemoryPatientDepartmentStore, assertStaffMayAccessPatient } from "../../artifacts/api-server/src/lib/patient-department-access";
import { staffPatientHistoryRows, type StaffHistorySourcePatient } from "../../artifacts/api-server/src/lib/staff-patient-history";
import { standardDepartmentLookup } from "./department-test-fixture";

const lookup = standardDepartmentLookup();
const registered = new Date("2026-03-02T02:15:00.000Z");
const membershipDate = new Date("2026-10-06T00:00:00.000Z");

const patients: StaffHistorySourcePatient[] = [
  { id: 2, patientHisId: "1240", lastName: "ROSAROSO", firstName: "JOEPHEL", middleName: null, createdAt: registered },
  { id: 5, patientHisId: "3214", lastName: "ABABON", firstName: "JORETO", middleName: null, createdAt: registered },
  { id: 6, patientHisId: "4386", lastName: "ABABON", firstName: "RUBIE", middleName: null, createdAt: registered },
  { id: 9, patientHisId: "9001", lastName: "NO", firstName: "MEMBERSHIP", middleName: null, createdAt: registered },
];

const store = createMemoryPatientDepartmentStore([
  { patientId: 2, departmentId: 2, registeredById: 9 },
  { patientId: 2, departmentId: 4, registeredById: 7 },
  { patientId: 5, departmentId: 2, registeredById: 9 },
  { patientId: 6, departmentId: 4, registeredById: 7 },
]);

async function rowsFor(role: string, search?: string) {
  const constraint = await staffDirectoryConstraint(role, lookup, store);
  assert.notEqual(constraint.kind, "error");
  if (constraint.kind === "error") return [];
  const allowedIds = constraint.kind === "ids" ? constraint.ids : "all";
  return staffPatientHistoryRows({ patients, allowedIds, search });
}

test("laboratory history is laboratory patients only, once each", async () => {
  const rows = await rowsFor("laboratory");
  assert.deepEqual(rows.map((row) => row.patientHisId), ["1240", "3214"]);
  assert.equal(rows.filter((row) => row.patientHisId === "1240").length, 1);
  assert.equal(rows.some((row) => row.patientHisId === "4386"), false);
  assert.equal(rows.some((row) => row.patientHisId === "9001"), false);
});

test("radiology history is radiology patients only", async () => {
  const rows = await rowsFor("radiology");
  assert.deepEqual(rows.map((row) => row.patientHisId).sort(), ["1240", "4386"]);
  assert.equal(rows.some((row) => row.patientHisId === "3214"), false);
});

test("endoscopy history does not include laboratory-only patients", async () => {
  const rows = await rowsFor("endoscopy");
  assert.deepEqual(rows, []);
});

test("medical records and super_admin remain global", async () => {
  const records = await rowsFor("medical_records");
  const admin = await rowsFor("super_admin");
  assert.deepEqual(records.map((row) => row.patientHisId), ["1240", "3214", "4386", "9001"]);
  assert.deepEqual(admin.map((row) => row.patientHisId), ["1240", "3214", "4386", "9001"]);
});

test("a shared patient appears once and registered date is patients.created_at", async () => {
  const rows = await rowsFor("laboratory");
  const duplicated = staffPatientHistoryRows({
    patients: [...patients, patients[1]!],
    allowedIds: (await staffDirectoryConstraint("laboratory", lookup, store) as { ids: number[] }).ids,
  });
  assert.equal(duplicated.filter((row) => row.id === 5).length, 1);
  const shared = rows.find((row) => row.patientHisId === "1240");
  const joreto = rows.find((row) => row.id === 5);
  assert.equal(shared?.name, "ROSAROSO, JOEPHEL");
  assert.equal(shared?.registeredAt, registered.toISOString());
  assert.notEqual(shared?.registeredAt, membershipDate.toISOString());
  assert.equal(joreto?.patientHisId, "3214");
  assert.equal(rows.filter((row) => row.id === 5).length, 1);
});

test("search and a client department id cannot widen the laboratory list", async () => {
  const parsed = ListPatientsQueryParams.parse({
    search: "JOEPHEL",
    departmentId: "4",
    patientId: "6",
    page: "99",
  });
  assert.equal("departmentId" in parsed, false);
  assert.equal("patientId" in parsed, false);
  assert.equal(parsed.search, "JOEPHEL");
  assert.equal(parsed.page, 99);
  const found = await rowsFor("laboratory", parsed.search);
  const paged = found.slice((parsed.page - 1) * parsed.limit, parsed.page * parsed.limit);
  assert.deepEqual(paged, []);
  assert.deepEqual(found.map((row) => row.patientHisId), ["1240"]);
  const otherDepartmentName = await rowsFor("laboratory", "RUBIE");
  assert.deepEqual(otherDepartmentName, []);
  const radiologyOnly = await assertStaffMayAccessPatient("laboratory", 6, lookup, store);
  assert.equal(radiologyOnly.ok, false);
});

test("patient list authorization does not read a client department id", () => {
  const route = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/routes/patients.ts"),
    "utf8",
  );
  const start = route.indexOf('router.get("/patients"');
  const end = route.indexOf('router.get("/patients/hospital-lookup"');
  const list = route.slice(start, end);
  assert.match(list, /resolveStaffPatientScope\(req, res\)/);
  assert.match(route, /staffDirectoryConstraint\(req\.user!\.role\)/);
  assert.equal(list.includes("departmentId"), false);
  assert.match(list, /requireAuth/);
  assert.match(list, /directory-summary/);
});
